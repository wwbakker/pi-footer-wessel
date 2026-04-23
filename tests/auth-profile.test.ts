import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("readActiveAuthProfile reads the active auth profile from the pi agent directory", async () => {
  const home = mkdtempSync(join(tmpdir(), "powerline-auth-home-"));
  const agentDir = join(home, "agent");
  const previousPiDir = process.env.PI_DIR;
  process.env.PI_DIR = home;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, ".auth-profile"), "personal\n", "utf8");

  try {
    const { getActiveAuthProfilePath, readActiveAuthProfile } = await import("../auth-profile.ts");

    assert.equal(getActiveAuthProfilePath(), join(agentDir, ".auth-profile"));
    assert.equal(readActiveAuthProfile(), "personal");
  } finally {
    if (previousPiDir === undefined) {
      delete process.env.PI_DIR;
    } else {
      process.env.PI_DIR = previousPiDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("readActiveAuthProfile returns null when the marker file is missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "powerline-auth-home-"));
  const agentDir = join(home, "agent");
  const previousPiDir = process.env.PI_DIR;
  process.env.PI_DIR = home;
  mkdirSync(agentDir, { recursive: true });

  try {
    const { readActiveAuthProfile } = await import("../auth-profile.ts");
    assert.equal(readActiveAuthProfile(), null);
  } finally {
    if (previousPiDir === undefined) {
      delete process.env.PI_DIR;
    } else {
      process.env.PI_DIR = previousPiDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("formatAuthProfileName truncates long names for compact footer rendering", async () => {
  const { formatAuthProfileName } = await import("../auth-profile.ts");

  assert.equal(formatAuthProfileName("personal"), "personal");
  assert.match(formatAuthProfileName("this-is-a-very-long-profile-name"), /this-is-a-very/);
  assert.match(formatAuthProfileName("this-is-a-very-long-profile-name"), /…/);
});
