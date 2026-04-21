# Original extension features

Based on an inspection of `~/Repos/personal/pi-extensions/pi-powerline-footer-original` (README, source, tests, and changelog), the original extension currently provides these features.

## 1. Powerline-style editor/status UI

- Replaces pi’s default editor chrome with a custom **powerline-style top status bar**.
- Renders the main status line **above the editor**, with optional secondary rows/widgets above or below the editor.
- Uses a **responsive layout**:
  - segments move between the top row and a secondary row depending on terminal width
  - overflow is handled gracefully rather than simply disappearing
- Includes multiple separator styles:
  - `powerline`
  - `powerline-thin`
  - `slash`
  - `pipe`
  - `dot`
  - `chevron`
  - `star`
  - `block`
  - `none`
  - `ascii`

## 2. Presets for different footer layouts

Built-in presets:

- `default`
- `minimal`
- `compact`
- `full`
- `nerd`
- `ascii`
- `custom`

These presets control:

- which segments are shown
- their ordering
- separator style
- path mode
- git detail level
- time formatting
- color scheme

The selected preset is persisted to `~/.pi/agent/settings.json`.

## 3. Footer/status segments

The extension supports these segment types:

- `pi`
- `model`
- `thinking`
- `shell_mode`
- `path`
- `git`
- `subagents` (defined, but currently not really used)
- `token_in`
- `token_out`
- `token_total`
- `cost`
- `context_pct`
- `context_total`
- `time_spent`
- `time`
- `session`
- `hostname`
- `cache_read`
- `cache_write`
- `extension_statuses`

## 4. Model and thinking-level display

- Shows the active model in the powerline bar.
- Shows the current thinking level.
- Thinking levels are color-coded.
- `high` and `xhigh` use a **rainbow/shimmer-like effect**.

## 5. Path display options

Path segment supports:

- `basename` mode
- `abbreviated` mode
- `full` mode

Behavior includes:

- home directory shown as `~`
- optional max-length truncation in abbreviated mode
- when bash mode is active, the path follows the managed shell’s cwd

## 6. Git integration

- Shows the current branch.
- Shows dirty state indicators:
  - staged: `+N`
  - unstaged: `*N`
  - untracked: `?N`
- Uses async/background git fetching with caching.
- Cache is invalidated on `write`/`edit` results.
- Detects likely branch-changing shell commands and refreshes branch/status.
- Handles detached HEAD by showing a short SHA with `(detached)`.

## 7. Context/token/cost awareness

- Shows context usage percentage and context window size.
- Color-codes context usage:
  - normal
  - warning (>70%)
  - error (>90%)
- Shows token usage and cache read/write counts.
- Formats large token counts compactly (`1.2k`, `45M`, etc.).
- Shows cost as dollars, or `(sub)` when a subscription-style usage is detected.
- Shows auto-compact state when available.
- If `pi-custom-compaction` is installed and enabled, it hides native context segments to avoid stale context info.

## 8. Welcome UI on startup

There are two startup experiences:

### Welcome overlay
- Centered branded startup overlay.
- Shows:
  - gradient pi logo
  - current model/provider
  - keyboard tips
  - counts of loaded context files/extensions/skills/prompt templates
  - recent sessions
- Dismisses on any key press or automatically after 30 seconds.
- Skips itself if the session already shows activity.

### Quiet startup header
- If `quietStartup: true` is set in settings, a persistent header version is shown instead of the overlay.

## 9. Working Vibes

A themed replacement for the default “Working...” message.

### Core behavior
- `/vibe <theme>` sets a theme such as `star trek`, `pirate`, `zen`, `noir`, etc.
- Before the agent starts, it shows a placeholder like `Channeling <theme>...`.
- Then it asynchronously updates the loading message to a short themed phrase.
- It can refresh during longer runs, especially on tool calls.

### Modes
- `generate`: on-demand AI generation
- `file`: read from a pre-generated local text file

### Commands
- `/vibe` — show current vibe state
- `/vibe <theme>` — set theme
- `/vibe off` — disable
- `/vibe mode` — show mode
- `/vibe mode generate`
- `/vibe mode file`
- `/vibe model`
- `/vibe model <provider/model>`
- `/vibe generate <theme> [count]` — batch-generate vibe lines into `~/.pi/agent/vibes/<theme>.txt`

### Additional vibe features
- configurable model
- configurable prompt template
- configurable fallback message
- configurable refresh interval
- configurable max message length
- tracks recent vibes to reduce repetition
- file mode uses seeded shuffle/no-repeat cycling behavior

## 10. Sticky bash mode

A major feature of the current original extension.

### What it does
- Adds a persistent managed shell session tied to the current pi session.
- Lets shell state persist across commands:
  - cwd changes persist
  - exported shell state can persist within the session
- Shows a `shell_mode` segment in the powerline bar.
- Displays recent shell transcript output below the editor.

### Commands
- `/bash-mode on`
- `/bash-mode off`
- `/bash-mode toggle`
- `/bash-reset`

### Shortcut
- default toggle shortcut: `ctrl+shift+b`

### Bash mode behavior
- Enter submits the shell command.
- Right Arrow accepts ghost text without submitting.
- Tab uses autocomplete/dropdown completion.
- Up/Down browse matching shell history.
- `escape` exits bash mode.
- `ctrl+c` interrupts the active shell job when appropriate.

### Transcript behavior
- Transcript appears below the editor.
- Keeps recent commands and their tail output.
- Truncates old transcript content by command boundaries.
- Preserves the currently running command even if it exceeds normal retention limits.

## 11. Shell completions and ghost suggestions

The extension enhances both sticky bash mode and one-off `!command` / `!!command` prompts.

### Completion sources
- per-project shell history
- global shell history
- shell-native completion adapters
- git-aware completions
- filesystem/path completions
- executable lookup from `PATH`

### Ranking behavior
- project history is ranked above global history
- native and deterministic completions are merged/ranked
- empty prompts can show a recent history-based ghost suggestion immediately

### One-off bash support
- `!command` and `!!command` reuse the same prediction/completion pipeline
- ghost acceptance works with Right Arrow there too

## 12. Editor stash

The extension includes a quick prompt stash workflow.

### Default shortcut
- `Alt+S`

### Behavior
- If the editor has text and no stash: stash it and clear the editor.
- If the editor is empty and a stash exists: restore the stash.
- If both editor text and stash exist: replace/update the stash with current editor text and clear the editor.
- If both are empty: show “Nothing to stash”.

### Auto-restore
- After an agent run, stashed text is auto-restored only if the editor is still empty.
- If the user typed something in the meantime, the stash is preserved instead.

### Status integration
- Shows a `stash` status indicator in the footer/status area when a stash is active.

## 13. Stash history and prompt history picker

### Stash history
- Persists up to 12 recent stashed prompts to:
  - `~/.pi/agent/powerline-footer/stash-history.json`

### Project prompt history
- Also reads recent user prompts from pi sessions in the current project.

### Access
- `/stash-history`
- default shortcut: `ctrl+alt+h`

### Insert behavior
When selecting a saved prompt, if the editor already has content the user can:
- `Replace`
- `Append`
- `Cancel`

## 14. Clipboard/editor text shortcuts

Built-in shortcuts:

- `ctrl+alt+c` — copy full editor content
- `ctrl+alt+x` — cut full editor content

These do not change stash state.

## 15. Last-prompt reminder widget

- Stores the latest user prompt.
- Shows a subtle below-editor reminder line with the last prompt text.
- Hidden while bash mode is active.
- Can be disabled with `showLastPrompt: false` in settings.

## 16. Extension status forwarding/cleanup

- Shows compact statuses from other extensions inside the powerline bar.
- Filters out empty/ANSI-only status noise.
- Strips duplicate/trailing separators from imported statuses.
- Also surfaces notification-style statuses above the editor.

## 17. Theme and color customization

- Uses pi theme colors plus optional custom hex colors.
- Supports semantic color mapping for things like:
  - model
  - path
  - shell mode
  - git clean/dirty
  - context warning/error
  - tokens
  - cost
- Allows overrides through a `theme.json` file in the extension directory.
- Includes a `theme.example.json`.
- Has nerd-font-friendly and ASCII-safe presentation options.

## 18. Shortcut/settings configuration

The extension reads from `~/.pi/agent/settings.json` for features like:

- selected powerline preset
- shortcut overrides (`powerlineShortcuts`)
- bash mode settings (`bashMode`)
- vibe settings
- `quietStartup`
- `showLastPrompt`

It validates shortcut overrides and falls back to safe defaults when there are conflicts or invalid values.

## 19. Commands exposed by the extension

The current original extension registers these slash commands:

- `/powerline` — toggle extension or show presets
- `/powerline <preset>` — switch preset
- `/stash-history` — open prompt history picker
- `/bash-mode [on|off|toggle]`
- `/bash-reset`
- `/vibe ...`

## 20. Keyboard shortcuts exposed by the extension

Default shortcuts found in the current code:

- `alt+s` — stash/restore/update editor stash
- `ctrl+shift+b` — toggle bash mode
- `ctrl+alt+h` — open prompt/stash history picker
- `ctrl+alt+c` — copy full editor text
- `ctrl+alt+x` — cut full editor text

## 21. Notable implementation details that may matter if you fork it

- It is not just a footer: it also replaces the editor component and adds multiple widgets.
- Bash mode is tightly integrated with the custom editor, autocomplete, ghost suggestions, transcript, and shell session management.
- Working Vibes has both runtime generation and persisted file-based content generation.
- The extension persists settings/history in multiple places under `~/.pi/agent/`.
- Some features are session-local (like the active stash and managed shell session), while others persist across restarts (preset, vibe settings, stash history, generated vibe files).

## Short version

At a high level, the original extension is a combination of:

1. a customizable powerline-style status bar
2. startup welcome UI
3. themed AI loading messages (“Working Vibes”)
4. editor stash/history/clipboard helpers
5. a fairly sophisticated sticky bash mode with transcript, completions, and ghost suggestions
6. various quality-of-life widgets around prompts, status, git, context, tokens, and cost
