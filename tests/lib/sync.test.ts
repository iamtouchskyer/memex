import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  readSyncConfig,
  writeSyncConfig,
  GitAdapter,
} from "../../src/lib/sync.js";

const execFile = promisify(execFileCb);

describe("sync config", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "memex-sync-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true });
  });

  it("returns default config when no file exists", async () => {
    const config = await readSyncConfig(home);
    expect(config).toEqual({ adapter: "git", auto: false });
  });

  it("writes and reads config", async () => {
    await writeSyncConfig(home, {
      remote: "git@github.com:user/cards.git",
      adapter: "git",
      auto: true,
      lastSync: "2026-03-20T17:00:00Z",
    });
    const config = await readSyncConfig(home);
    expect(config.remote).toBe("git@github.com:user/cards.git");
    expect(config.auto).toBe(true);
  });
});

describe("GitAdapter", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "memex-sync-"));
    await mkdir(join(home, "cards"), { recursive: true });
    await writeFile(
      join(home, "cards", "test.md"),
      "---\ntitle: Test\ncreated: 2026-03-20\nsource: retro\n---\nHello",
      "utf-8"
    );
  });

  afterEach(async () => {
    await rm(home, { recursive: true });
  });

  async function createBareRemote(): Promise<string> {
    const bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await execFile("git", ["init", "--bare", bare]);
    return bare;
  }

  it("init with URL sets up git repo and remote", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    const config = await readSyncConfig(home);
    expect(config.remote).toBe(bare);
    expect(config.adapter).toBe("git");

    const { stdout } = await execFile("git", ["-C", home, "remote", "-v"]);
    expect(stdout).toContain(bare);

    await rm(bare, { recursive: true });
  });

  it("sync commits and pushes changes", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Add a new card
    await writeFile(
      join(home, "cards", "new.md"),
      "---\ntitle: New\ncreated: 2026-03-20\nsource: retro\n---\nNew card",
      "utf-8"
    );

    const result = await adapter.sync();
    expect(result.success).toBe(true);

    // Verify push — clone bare and check
    const clone = await mkdtemp(join(tmpdir(), "memex-clone-"));
    await execFile("git", ["clone", bare, clone]);
    const content = await readFile(join(clone, "cards", "new.md"), "utf-8");
    expect(content).toContain("New card");

    await rm(bare, { recursive: true });
    await rm(clone, { recursive: true });
  }, 15000);

  it("sync with nothing to commit succeeds", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    const result = await adapter.sync();
    expect(result.success).toBe(true);

    await rm(bare, { recursive: true });
  }, 15000);

  it("status returns configured state", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    const status = await adapter.status();
    expect(status.configured).toBe(true);
    expect(status.remote).toBe(bare);
    expect(status.adapter).toBe("git");
    expect(status.auto).toBe(false);

    await rm(bare, { recursive: true });
  });

  it("status returns unconfigured when no sync.json", async () => {
    const adapter = new GitAdapter(home);
    const status = await adapter.status();
    expect(status.configured).toBe(false);
  });

  it("status self-heals by reading git remote when sync.json has no remote", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Remove remote from sync config but keep git remote
    await writeSyncConfig(home, { adapter: "git", auto: false });

    const status = await adapter.status();
    expect(status.configured).toBe(true);
    expect(status.remote).toBe(bare);

    // Verify it persisted the fix
    const config = await readSyncConfig(home);
    expect(config.remote).toBe(bare);

    await rm(bare, { recursive: true });
  });

  it("pull returns offline message when fetch fails", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Delete bare remote to simulate network failure
    await rm(bare, { recursive: true });

    const result = await adapter.pull();
    expect(result.success).toBe(true);
    expect(result.message).toContain("Offline");
  });

  it("pull detects merge conflict and aborts cleanly", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Create a second clone and push a conflicting change
    const clone2 = await mkdtemp(join(tmpdir(), "memex-clone2-"));
    await execFile("git", ["clone", bare, clone2]);
    await writeFile(
      join(clone2, "cards", "test.md"),
      "---\ntitle: Test\ncreated: 2026-03-20\nsource: retro\n---\nConflicting content from clone2",
      "utf-8"
    );
    await execFile("git", ["-C", clone2, "add", "-A"]);
    await execFile("git", ["-C", clone2, "commit", "-m", "conflict from clone2"]);
    await execFile("git", ["-C", clone2, "push", "origin", "HEAD"]);

    // Now modify the same file locally
    await writeFile(
      join(home, "cards", "test.md"),
      "---\ntitle: Test\ncreated: 2026-03-20\nsource: retro\n---\nConflicting content from local",
      "utf-8"
    );
    await execFile("git", ["-C", home, "add", "-A"]);
    await execFile("git", ["-C", home, "commit", "-m", "local conflicting change"]);

    const result = await adapter.pull();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Merge conflict");

    await rm(bare, { recursive: true });
    await rm(clone2, { recursive: true });
  }, 20000);

  it("push fails gracefully when remote is gone", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Delete bare remote
    await rm(bare, { recursive: true });

    // Add a new card and try to push
    await writeFile(
      join(home, "cards", "orphan.md"),
      "---\ntitle: Orphan\ncreated: 2026-03-20\n---\nNo remote",
      "utf-8"
    );
    const result = await adapter.push();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Push failed");
  });

  it("init throws when git is not available", async () => {
    // Save original PATH and set to empty to simulate no git
    const origPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const adapter = new GitAdapter(home);
      await expect(adapter.init("https://example.com/repo.git")).rejects.toThrow(
        "git is required"
      );
    } finally {
      process.env.PATH = origPath;
    }
  });

  it("re-init with same remote succeeds (remote set-url)", async () => {
    const bare = await createBareRemote();
    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Re-init with same remote should not throw
    await adapter.init(bare);
    const config = await readSyncConfig(home);
    expect(config.remote).toBe(bare);

    await rm(bare, { recursive: true });
  }, process.platform === 'win32' ? 15000 : 5000);
});
