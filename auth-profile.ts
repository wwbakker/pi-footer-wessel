import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIVE_PROFILE_FILE = ".auth-profile";

/**
 * Resolve the pi agent directory (~/.pi/agent/).
 * Uses the same env/default logic as pi core and the auth profile extension.
 */
export function getPiAgentDir(): string {
  const piDir = process.env.PI_DIR || join(process.env.HOME || "~", ".pi");
  return join(piDir, "agent");
}

/** Absolute path to the active auth profile marker file. */
export function getActiveAuthProfilePath(): string {
  return join(getPiAgentDir(), ACTIVE_PROFILE_FILE);
}

/**
 * Read the active auth profile name from disk.
 * Returns null when no marker exists or when the file is empty.
 */
export function readActiveAuthProfile(): string | null {
  const filePath = getActiveAuthProfilePath();
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const profileName = readFileSync(filePath, "utf-8").trim();
    return profileName || null;
  } catch {
    return null;
  }
}

/** Truncate long profile names to keep the footer compact. */
export function formatAuthProfileName(name: string): string {
  const maxWidth = 16;
  const characters = Array.from(name);
  if (characters.length <= maxWidth) {
    return name;
  }
  return `${characters.slice(0, maxWidth - 1).join("")}…`;
}
