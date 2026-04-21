import {
  CustomEditor,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { ColorScheme, SegmentContext, StatusLinePreset, StatusLineSegmentId } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getSeparator } from "./separators.js";
import { renderSegment } from "./segments.js";
import { getGitStatus, invalidateGitBranch, invalidateGitStatus } from "./git-status.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.js";
import { getDefaultColors } from "./theme.js";
import {
  generateVibesBatch,
  getVibeFileCount,
  getVibeMode,
  getVibeModel,
  getVibeTheme,
  hasVibeFile,
  initVibeManager,
  onVibeAgentEnd,
  onVibeAgentStart,
  onVibeBeforeAgentStart,
  onVibeToolCall,
  setVibeMode,
  setVibeModel,
  setVibeTheme,
} from "./working-vibes.js";

interface PowerlineConfig {
  preset: StatusLinePreset;
}

const CUSTOM_COMPACTION_STATUS_KEY = "compact-policy";
const PROMPT_HISTORY_LIMIT = 100;
const PROMPT_HISTORY_TRACKED = Symbol.for("footerWesselPromptHistoryTracked");
const PROMPT_HISTORY_STATE_KEY = Symbol.for("footerWesselPromptHistoryState");

let customCompactionEnabled = false;

interface PromptHistoryState {
  savedPromptHistory: string[];
}

type PromptHistoryGlobal = typeof globalThis & {
  [PROMPT_HISTORY_STATE_KEY]?: PromptHistoryState;
};

type SessionAssistantUsage = AssistantMessage["usage"];

type EditorWithHistory = CustomEditor & {
  history?: unknown[];
  addToHistory?: (text: string) => void;
  autocompleteProvider?: unknown;
  [PROMPT_HISTORY_TRACKED]?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSessionAssistantUsage(value: unknown): value is SessionAssistantUsage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.input !== "number"
    || typeof value.output !== "number"
    || typeof value.cacheRead !== "number"
    || typeof value.cacheWrite !== "number"
  ) {
    return false;
  }

  return isRecord(value.cost) && typeof value.cost.total === "number";
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && hasSessionAssistantUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

function getPromptHistoryState(): PromptHistoryState {
  const globalState = globalThis as PromptHistoryGlobal;
  if (!globalState[PROMPT_HISTORY_STATE_KEY]) {
    globalState[PROMPT_HISTORY_STATE_KEY] = { savedPromptHistory: [] };
  }
  return globalState[PROMPT_HISTORY_STATE_KEY];
}

function readPromptHistory(editor: EditorWithHistory | null): string[] {
  const history = editor?.history;
  if (!Array.isArray(history)) {
    return [];
  }

  const normalized: string[] = [];
  for (const entry of history) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    if (normalized.length > 0 && normalized[normalized.length - 1] === trimmed) {
      continue;
    }

    normalized.push(trimmed);
    if (normalized.length >= PROMPT_HISTORY_LIMIT) {
      break;
    }
  }

  return normalized;
}

function snapshotPromptHistory(editor: EditorWithHistory | null): void {
  const history = readPromptHistory(editor);
  if (history.length > 0) {
    getPromptHistoryState().savedPromptHistory = [...history];
  }
}

function restorePromptHistory(editor: EditorWithHistory | null): void {
  const { savedPromptHistory } = getPromptHistoryState();
  if (!savedPromptHistory.length || typeof editor?.addToHistory !== "function") {
    return;
  }

  for (let i = savedPromptHistory.length - 1; i >= 0; i -= 1) {
    editor.addToHistory(savedPromptHistory[i]!);
  }
}

function trackPromptHistory(editor: EditorWithHistory | null): void {
  if (!editor || typeof editor.addToHistory !== "function") {
    return;
  }

  if (editor[PROMPT_HISTORY_TRACKED]) {
    snapshotPromptHistory(editor);
    return;
  }

  const originalAddToHistory = editor.addToHistory.bind(editor);
  editor.addToHistory = (text: string) => {
    originalAddToHistory(text);
    snapshotPromptHistory(editor);
  };
  editor[PROMPT_HISTORY_TRACKED] = true;
  snapshotPromptHistory(editor);
}

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "settings.json");
}

function getGlobalCompactionPolicyPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "compaction-policy.json");
}

function getCustomCompactionExtensionPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "extensions", "pi-custom-compaction");
}

function readCompactionPolicyEnabled(configPath: string): boolean | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.enabled !== "boolean") {
      return false;
    }
    return parsed.enabled;
  } catch (error) {
    console.debug(`[footer-wessel] Failed to read compaction policy from ${configPath}:`, error);
    return false;
  }
}

function detectCustomCompactionEnabled(cwd: string): boolean {
  if (!existsSync(getCustomCompactionExtensionPath())) {
    return false;
  }

  const projectSetting = readCompactionPolicyEnabled(join(cwd, ".pi", "compaction-policy.json"));
  if (projectSetting !== undefined) {
    return projectSetting;
  }

  return readCompactionPolicyEnabled(getGlobalCompactionPolicyPath()) ?? false;
}

function readSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath();
  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[footer-wessel] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }
    return parsed;
  } catch (error) {
    console.debug(`[footer-wessel] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function writePowerlinePresetSetting(preset: StatusLinePreset): boolean {
  const settingsPath = getSettingsPath();
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (!isRecord(parsed)) {
        console.debug(`[footer-wessel] Refusing to write preset to non-object settings at ${settingsPath}`);
        return false;
      }
      settings = parsed;
    } catch (error) {
      console.debug(`[footer-wessel] Failed to parse settings at ${settingsPath}:`, error);
      return false;
    }
  }

  settings.footerWessel = preset;

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[footer-wessel] Failed to persist preset to ${settingsPath}:`, error);
    return false;
  }
}

function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function normalizePreset(value: unknown): StatusLinePreset | null {
  if (typeof value !== "string") {
    return null;
  }

  const preset = value.trim().toLowerCase();
  return isValidPreset(preset) ? preset : null;
}

function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext,
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

function buildContentFromParts(
  parts: string[],
  presetDef: ReturnType<typeof getPreset>,
): string {
  if (parts.length === 0) {
    return "";
  }

  const separatorDef = getSeparator(presetDef.separator);
  const sepAnsi = getFgAnsiCode("sep");
  const sep = separatorDef.left;
  return ` ${parts.join(` ${sepAnsi}${sep}${ansi.reset} `)}${ansi.reset} `;
}

function computeResponsiveLayout(
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>,
  availableWidth: number,
): { topContent: string; secondaryContent: string } {
  const separatorDef = getSeparator(presetDef.separator);
  const sepWidth = visibleWidth(separatorDef.left) + 2;
  const primaryIds = [...presetDef.leftSegments, ...presetDef.rightSegments];
  const secondaryIds = presetDef.secondarySegments ?? [];
  const allSegmentIds = [...primaryIds, ...secondaryIds];

  const renderedSegments: Array<{ content: string; width: number }> = [];
  for (const segId of allSegmentIds) {
    const { content, width, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      renderedSegments.push({ content, width });
    }
  }

  if (renderedSegments.length === 0) {
    return { topContent: "", secondaryContent: "" };
  }

  const baseOverhead = 2;
  let currentWidth = baseOverhead;
  const topSegments: string[] = [];
  const overflowSegments: Array<{ content: string; width: number }> = [];
  let overflow = false;

  for (const seg of renderedSegments) {
    const neededWidth = seg.width + (topSegments.length > 0 ? sepWidth : 0);
    if (!overflow && currentWidth + neededWidth <= availableWidth) {
      topSegments.push(seg.content);
      currentWidth += neededWidth;
    } else {
      overflow = true;
      overflowSegments.push(seg);
    }
  }

  let secondaryWidth = baseOverhead;
  const secondarySegments: string[] = [];
  for (const seg of overflowSegments) {
    const neededWidth = seg.width + (secondarySegments.length > 0 ? sepWidth : 0);
    if (secondaryWidth + neededWidth <= availableWidth) {
      secondarySegments.push(seg.content);
      secondaryWidth += neededWidth;
    } else {
      break;
    }
  }

  return {
    topContent: buildContentFromParts(topSegments, presetDef),
    secondaryContent: buildContentFromParts(secondarySegments, presetDef),
  };
}

function mightChangeGitBranch(command: string): boolean {
  const gitBranchPatterns = [
    /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
    /\bgit\s+stash\s+(pop|apply)/,
  ];
  return gitBranchPatterns.some((pattern) => pattern.test(command));
}

export default function footerWessel(pi: ExtensionAPI) {
  const config: PowerlineConfig = {
    preset: "default",
  };

  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let isStreaming = false;
  let tuiRef: { requestRender: () => void } | null = null;
  let dismissWelcomeOverlay: (() => void) | null = null;
  let welcomeHeaderActive = false;
  let welcomeOverlayShouldDismiss = false;
  let lastUserPrompt = "";
  let showLastPrompt = true;
  let currentEditor: EditorWithHistory | null = null;

  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;

  const requestRender = (): void => {
    lastLayoutResult = null;
    tuiRef?.requestRender();
  };

  function getRecentAgentContext(ctx: any): string | undefined {
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];

    for (let i = sessionEvents.length - 1; i >= 0; i -= 1) {
      const entry = sessionEvents[i];
      if (entry.type === "message" && entry.message?.role === "assistant") {
        const content = entry.message.content;
        if (!Array.isArray(content)) {
          continue;
        }

        for (const block of content) {
          if (block.type === "text" && block.text) {
            const text = String(block.text).trim();
            if (text.length > 0) {
              return text.slice(0, 200);
            }
          }
        }
      }
    }

    return undefined;
  }

  function dismissWelcome(ctx: any): void {
    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      welcomeOverlayShouldDismiss = true;
    }

    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  }

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const presetDef = getPreset(config.preset);
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let lastAssistant: AssistantMessage | undefined;
    let thinkingLevelFromSession: string | null = null;

    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    for (const entry of sessionEvents) {
      if (!isRecord(entry)) {
        continue;
      }

      if (entry.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
        thinkingLevelFromSession = entry.thinkingLevel;
      }

      if (entry.type !== "message" || !isSessionAssistantMessage(entry.message)) {
        continue;
      }

      const message = entry.message;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        continue;
      }

      input += message.usage.input;
      output += message.usage.output;
      cacheRead += message.usage.cacheRead;
      cacheWrite += message.usage.cacheWrite;
      cost += message.usage.cost.total;
      lastAssistant = message;
    }

    const contextTokens = lastAssistant
      ? lastAssistant.usage.input + lastAssistant.usage.output + lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
      : 0;
    const contextWindow = ctx.model?.contextWindow || 0;
    const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch);
    const extensionStatuses = footerDataRef?.getExtensionStatuses() ?? new Map();
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;
    const thinkingLevel = thinkingLevelFromSession ?? getThinkingLevelFn?.() ?? "off";

    return {
      model: ctx.model,
      thinkingLevel,
      sessionId: ctx.sessionManager?.getSessionId?.(),
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      customCompactionEnabled: customCompactionEnabled || extensionStatuses.has(CUSTOM_COMPACTION_STATUS_KEY),
      usingSubscription,
      sessionStartTime,
      git: gitStatus,
      extensionStatuses,
      options: presetDef.segmentOptions ?? {},
      theme,
      colors,
    };
  }

  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    if (lastLayoutResult && lastLayoutWidth === width && now - lastLayoutTimestamp < 50) {
      return lastLayoutResult;
    }

    const presetDef = getPreset(config.preset);
    const segmentCtx = buildSegmentContext(currentCtx, theme);

    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);
    lastLayoutTimestamp = now;

    return lastLayoutResult;
  }

  function setupCustomEditor(ctx: any): void {
    snapshotPromptHistory(currentEditor);
    if (!enabled) {
      return;
    }

    let autocompleteFixed = false;

    const editorFactory = (tui: any, editorTheme: Theme, keybindings: any): EditorWithHistory => {
      const editor = new CustomEditor(tui, editorTheme, keybindings) as EditorWithHistory;
      currentEditor = editor;
      trackPromptHistory(editor);
      restorePromptHistory(editor);

      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        if (!autocompleteFixed && !editor.autocompleteProvider) {
          autocompleteFixed = true;
          snapshotPromptHistory(editor);
          ctx.ui.setEditorComponent(editorFactory);
          currentEditor?.handleInput(data);
          return;
        }

        setTimeout(() => dismissWelcome(ctx), 0);
        originalHandleInput(data);
      };

      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) {
          return originalRender(width);
        }

        const borderColor = (text: string): string => `${getFgAnsiCode("sep")}${text}${ansi.reset}`;
        const prompt = `${ansi.getFgAnsi(200, 200, 200)}> ${ansi.reset}`;
        const promptPrefix = ` ${prompt}`;
        const contPrefix = "   ";
        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);

        if (lines.length === 0 || !currentCtx) {
          return lines;
        }

        let bottomBorderIndex = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i -= 1) {
          const stripped = (lines[i] ?? "").replace(/\x1b\[[0-9;]*m/g, "");
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = i;
            break;
          }
        }

        const result: string[] = [];
        const layout = getResponsiveLayout(width, ctx.ui.theme);
        result.push(layout.topContent);
        result.push(` ${borderColor("─".repeat(width - 2))}`);

        for (let i = 1; i < bottomBorderIndex; i += 1) {
          const prefix = i === 1 ? promptPrefix : contPrefix;
          result.push(`${prefix}${lines[i] ?? ""}`);
        }

        if (bottomBorderIndex === 1) {
          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
        }

        result.push(` ${borderColor("─".repeat(width - 2))}`);

        for (let i = bottomBorderIndex + 1; i < lines.length; i += 1) {
          result.push(lines[i] ?? "");
        }

        return result;
      };

      return editor;
    };

    ctx.ui.setEditorComponent(editorFactory);

    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;
      const unsubscribe = footerData.onBranchChange(() => requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(): string[] {
          return [];
        },
      };
    });

    ctx.ui.setWidget("footer-wessel-secondary", (_tui: any, theme: Theme) => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        if (!currentCtx) {
          return [];
        }

        const layout = getResponsiveLayout(width, theme);
        return layout.secondaryContent ? [layout.secondaryContent] : [];
      },
    }), { placement: "belowEditor" });

    ctx.ui.setWidget("footer-wessel-status", () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        if (!currentCtx || !footerDataRef) {
          return [];
        }

        const statuses = footerDataRef.getExtensionStatuses();
        if (!statuses || statuses.size === 0) {
          return [];
        }

        const notifications: string[] = [];
        for (const value of statuses.values()) {
          if (value && value.trimStart().startsWith("[")) {
            const lineContent = ` ${value}`;
            if (visibleWidth(lineContent) <= width) {
              notifications.push(lineContent);
            }
          }
        }

        return notifications;
      },
    }), { placement: "aboveEditor" });

    ctx.ui.setWidget("footer-wessel-last-prompt", () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        if (!showLastPrompt || !lastUserPrompt) {
          return [];
        }

        const prefix = ` ${getFgAnsiCode("sep")}↳${ansi.reset} `;
        const availableWidth = width - visibleWidth(prefix);
        if (availableWidth < 10) {
          return [];
        }

        let promptText = lastUserPrompt.replace(/\s+/g, " ").trim();
        if (!promptText) {
          return [];
        }

        promptText = truncateToWidth(promptText, availableWidth, "…");
        const styledPrompt = `${getFgAnsiCode("sep")}${promptText}${ansi.reset}`;
        const line = `${prefix}${styledPrompt}`;
        return [truncateToWidth(line, width, "…")];
      },
    }), { placement: "belowEditor" });
  }

  function setupWelcomeHeader(ctx: any): void {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);

    welcomeHeaderActive = true;
    ctx.ui.setHeader(() => ({
      render(width: number): string[] {
        return header.render(width);
      },
      invalidate(): void {
        header.invalidate();
      },
    }));
  }

  function setupWelcomeOverlay(ctx: any): void {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);

    setTimeout(() => {
      if (!enabled || welcomeOverlayShouldDismiss || isStreaming) {
        welcomeOverlayShouldDismiss = false;
        return;
      }

      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((entry: any) => (
        (entry.type === "message" && entry.message?.role === "assistant")
        || entry.type === "tool_call"
        || entry.type === "tool_result"
      ));
      if (hasActivity) {
        return;
      }

      ctx.ui.custom(
        (tui: any, _theme: Theme, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(modelName, providerName, recentSessions, loadedCounts);
          let countdown = 30;
          let dismissed = false;

          const dismiss = (): void => {
            if (dismissed) {
              return;
            }
            dismissed = true;
            clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };

          dismissWelcomeOverlay = dismiss;
          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }

          const interval = setInterval(() => {
            if (dismissed) {
              return;
            }
            countdown -= 1;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) {
              dismiss();
            }
          }, 1000);

          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: () => dismiss(),
            dispose: () => {
              dismissed = true;
              clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
            nonCapturing: true,
          }),
        },
      ).catch((error: unknown) => {
        console.debug("[footer-wessel] Welcome overlay failed:", error);
      });
    }, 100);
  }

  pi.on("session_start", async (event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;
    customCompactionEnabled = detectCustomCompactionEnabled(ctx.cwd);
    lastUserPrompt = "";
    isStreaming = false;

    const settings = readSettings();
    showLastPrompt = settings.showLastPrompt !== false;
    config.preset = normalizePreset(settings.footerWessel) ?? "default";

    getThinkingLevelFn = typeof ctx.getThinkingLevel === "function"
      ? () => ctx.getThinkingLevel()
      : null;

    initVibeManager(ctx);

    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
      if (event.reason === "startup") {
        if (settings.quietStartup === true) {
          setupWelcomeHeader(ctx);
        } else {
          setupWelcomeOverlay(ctx);
        }
      } else {
        dismissWelcome(ctx);
      }
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentEditor = null;
    dismissWelcome(ctx);
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }

    if (event.toolName === "bash" && event.input?.command) {
      const command = String(event.input.command);
      if (mightChangeGitBranch(command)) {
        invalidateGitStatus();
        invalidateGitBranch();
        setTimeout(requestRender, 100);
      }
    }
  });

  pi.on("user_bash", async (event) => {
    if (mightChangeGitBranch(event.command)) {
      invalidateGitStatus();
      invalidateGitBranch();
      setTimeout(requestRender, 100);
      setTimeout(requestRender, 300);
      setTimeout(requestRender, 500);
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx;
    requestRender();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    lastUserPrompt = event.prompt;
    if (ctx.hasUI) {
      onVibeBeforeAgentStart(event.prompt, ctx.ui.setWorkingMessage);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    onVibeAgentStart();
    dismissWelcome(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    dismissWelcome(ctx);
    if (ctx.hasUI) {
      const agentContext = getRecentAgentContext(ctx);
      onVibeToolCall(event.toolName, event.input, ctx.ui.setWorkingMessage, agentContext);
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    currentCtx = ctx;
    if (ctx.hasUI) {
      onVibeAgentEnd(ctx.ui.setWorkingMessage);
    }
    requestRender();
  });

  pi.registerCommand("footer-wessel", {
    description: "Configure footer-wessel status (toggle, preset)",
    handler: async (args, ctx) => {
      currentCtx = ctx;

      if (!args?.trim()) {
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          getPromptHistoryState().savedPromptHistory = [];
          footerDataRef = null;
          tuiRef = null;
          currentEditor = null;
          lastLayoutResult = null;
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("footer-wessel-secondary", undefined);
          ctx.ui.setWidget("footer-wessel-status", undefined);
          ctx.ui.setWidget("footer-wessel-last-prompt", undefined);
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      const preset = normalizePreset(args);
      if (preset) {
        config.preset = preset;
        lastLayoutResult = null;
        if (enabled) {
          setupCustomEditor(ctx);
        }

        if (writePowerlinePresetSetting(preset)) {
          ctx.ui.notify(`Preset set to: ${preset}`, "info");
        } else {
          ctx.ui.notify(`Preset set to: ${preset} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      ctx.ui.notify(`Available presets: ${Object.keys(PRESETS).join(", ")}`, "info");
    },
  });

  pi.registerCommand("vibe", {
    description: "Set working message theme. Usage: /vibe [theme|off|mode|model|generate]",
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) || [];
      const subcommand = parts[0]?.toLowerCase();

      if (!args || !args.trim()) {
        const theme = getVibeTheme();
        const mode = getVibeMode();
        const model = getVibeModel();
        let status = `Vibe: ${theme || "off"} | Mode: ${mode} | Model: ${model}`;
        if (theme && mode === "file") {
          const count = getVibeFileCount(theme);
          status += count > 0 ? ` | File: ${count} vibes` : " | File: not found";
        }
        ctx.ui.notify(status, "info");
        return;
      }

      if (subcommand === "model") {
        const modelSpec = parts.slice(1).join(" ");
        if (!modelSpec) {
          ctx.ui.notify(`Current vibe model: ${getVibeModel()}`, "info");
          return;
        }

        if (!modelSpec.includes("/")) {
          ctx.ui.notify("Invalid model format. Use: provider/modelId (e.g., openai-codex/gpt-5.4-mini)", "error");
          return;
        }

        const persisted = setVibeModel(modelSpec);
        if (persisted) {
          ctx.ui.notify(`Vibe model set to: ${modelSpec}`, "info");
        } else {
          ctx.ui.notify(`Vibe model set to: ${modelSpec} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      if (subcommand === "mode") {
        const newMode = parts[1]?.toLowerCase();
        if (!newMode) {
          ctx.ui.notify(`Current vibe mode: ${getVibeMode()}`, "info");
          return;
        }

        if (newMode !== "generate" && newMode !== "file") {
          ctx.ui.notify("Invalid mode. Use: generate or file", "error");
          return;
        }

        const theme = getVibeTheme();
        if (newMode === "file" && theme && !hasVibeFile(theme)) {
          ctx.ui.notify(`No vibe file for "${theme}". Run /vibe generate ${theme} first`, "error");
          return;
        }

        const persisted = setVibeMode(newMode);
        if (persisted) {
          ctx.ui.notify(`Vibe mode set to: ${newMode}`, "info");
        } else {
          ctx.ui.notify(`Vibe mode set to: ${newMode} (not persisted; check settings.json)`, "warning");
        }
        return;
      }

      if (subcommand === "generate") {
        const theme = parts[1];
        const parsedCount = Number.parseInt(parts[2] ?? "", 10);
        const count = Number.isFinite(parsedCount)
          ? Math.min(Math.max(Math.floor(parsedCount), 1), 500)
          : 100;

        if (!theme) {
          ctx.ui.notify("Usage: /vibe generate <theme> [count]", "error");
          return;
        }

        ctx.ui.notify(`Generating ${count} vibes for "${theme}"...`, "info");
        const result = await generateVibesBatch(theme, count);
        if (result.success) {
          ctx.ui.notify(`Generated ${result.count} vibes for "${theme}" → ${result.filePath}`, "info");
        } else {
          ctx.ui.notify(`Failed to generate vibes: ${result.error}`, "error");
        }
        return;
      }

      if (subcommand === "off") {
        const persisted = setVibeTheme(null);
        if (persisted) {
          ctx.ui.notify("Vibe disabled", "info");
        } else {
          ctx.ui.notify("Vibe disabled (not persisted; check settings.json)", "warning");
        }
        return;
      }

      const theme = args.trim();
      const persisted = setVibeTheme(theme);
      const mode = getVibeMode();
      if (mode === "file" && !hasVibeFile(theme)) {
        const suffix = persisted ? "" : " (not persisted; check settings.json)";
        ctx.ui.notify(`Vibe set to: ${theme} (file mode, but no file found - run /vibe generate ${theme})${suffix}`, "warning");
      } else if (persisted) {
        ctx.ui.notify(`Vibe set to: ${theme}`, "info");
      } else {
        ctx.ui.notify(`Vibe set to: ${theme} (not persisted; check settings.json)`, "warning");
      }
    },
  });
}
