import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { syncCommand } from "../../src/commands/sync.js";

const execFile = promisify(execFileCb);

describe("syncCommand", () => {
  let home: string;
  let bare: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "memex-sync-cmd-"));
    bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await mkdir(join(home, "cards"), { recursive: true });
    await writeFile(
      join(home, "cards", "test.md"),
      "---\ntitle: Test\ncreated: 2026-03-20\nsource: retro\n---\nHello"
    );
    await execFile("git", ["init", "--bare", bare]);
  });

  afterEach(async () => {
    await rm(home, { recursive: true });
    await rm(bare, { recursive: true });
  });

  it("init with URL configures sync", async () => {
    const result = await syncCommand(home, { init: true, remote: bare });
    expect(result.success).toBe(true);
  });

  it("sync after init succeeds", async () => {
    await syncCommand(home, { init: true, remote: bare });
    const result = await syncCommand(home, {});
    expect(result.success).toBe(true);
  }, 15000);

  it("status shows configured after init", async () => {
    await syncCommand(home, { init: true, remote: bare });
    const result = await syncCommand(home, { status: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain(bare);
  });

  it("auto on/off toggles config", async () => {
    await syncCommand(home, { init: true, remote: bare });
    await syncCommand(home, { auto: "on" });
    let status = await syncCommand(home, { status: true });
    expect(status.output).toContain("auto: on");

    await syncCommand(home, { auto: "off" });
    status = await syncCommand(home, { status: true });
    expect(status.output).toContain("auto: off");
  });

  it("sync without init fails gracefully", async () => {
    const result = await syncCommand(home, {});
    expect(result.success).toBe(false);
  }, 30000); // Increase timeout to 30s for Windows compatibility

  it("push after init succeeds (does not corrupt remote)", async () => {
    await syncCommand(home, { init: true, remote: bare });
    const result = await syncCommand(home, { action: "push" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Pushed");
  }, 20000);

  it("pull after init succeeds", async () => {
    await syncCommand(home, { init: true, remote: bare });
    const result = await syncCommand(home, { action: "pull" });
    expect(result.success).toBe(true);
  });

  it("push without init fails gracefully", async () => {
    const result = await syncCommand(home, { action: "push" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not initialized");
  });

  it("pull without init fails gracefully", async () => {
    const result = await syncCommand(home, { action: "pull" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not initialized");
  });

  it("bare word without --init does not trigger init", async () => {
    // Simulates what the fixed CLI does: without --init, arg is NOT passed as remote
    const result = await syncCommand(home, { init: false, remote: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Sync not initialized");
  });

  it("--init with URL still works", async () => {
    const result = await syncCommand(home, { init: true, remote: bare });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Sync initialized");
  }, 20000);
});
