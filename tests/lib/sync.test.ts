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
    // Ensure HEAD points to main so clones check out the right branch
    await execFile("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);
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
    expect(result.success).toBe(true);
    expect(result.message).toContain("conflicts auto-resolved");
    expect(result.message).toContain("conflict");

    // Verify local version is preserved (ours)
    const localContent = await readFile(join(home, "cards", "test.md"), "utf-8");
    expect(localContent).toContain("Conflicting content from local");

    // Verify theirs is saved as conflict copy
    const { readdir: readdirSync } = await import("node:fs/promises");
    const cards = await readdirSync(join(home, "cards"));
    const conflictFile = cards.find((f: string) => f.includes("-conflict-"));
    expect(conflictFile).toBeDefined();
    const theirsContent = await readFile(join(home, "cards", conflictFile!), "utf-8");
    expect(theirsContent).toContain("Conflicting content from clone2");

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
  });

  it("init rejects bare word 'push' as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("push")).rejects.toThrow("Invalid remote URL");
  });

  it("init rejects bare word 'pull' as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("pull")).rejects.toThrow("Invalid remote URL");
  });

  it("init rejects any bare word as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("anything")).rejects.toThrow("Invalid remote URL");
  });

  it("init rejects relative path 'foo/bar' as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("foo/bar")).rejects.toThrow("Invalid remote URL");
  });

  it("init rejects 'not@valid' (no colon after host) as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("not@valid")).rejects.toThrow("Invalid remote URL");
  });

  it("init rejects '../traversal' as invalid URL", async () => {
    const adapter = new GitAdapter(home);
    await expect(adapter.init("../traversal")).rejects.toThrow("Invalid remote URL");
  });

  it("init normalizes local branch to match remote default (master → main)", async () => {
    // Create a bare remote with 'main' as its branch
    const bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await execFile("git", ["init", "--bare", bare]);
    // Push a dummy commit to establish 'main' on the remote
    const seed = await mkdtemp(join(tmpdir(), "memex-seed-"));
    await execFile("git", ["init", seed]);
    await execFile("git", ["-C", seed, "checkout", "-b", "main"]);
    await writeFile(join(seed, "README.md"), "seed", "utf-8");
    await execFile("git", ["-C", seed, "add", "."]);
    await execFile("git", ["-C", seed, "commit", "-m", "seed"]);
    await execFile("git", ["-C", seed, "remote", "add", "origin", bare]);
    await execFile("git", ["-C", seed, "push", "-u", "origin", "main"]);
    // Set HEAD on bare to refs/heads/main
    await execFile("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

    // Now init local repo on 'master' (simulating old git default)
    await execFile("git", ["init", home]);
    await execFile("git", ["-C", home, "checkout", "-b", "master"]);

    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Local branch should now be 'main', not 'master'
    const { stdout } = await execFile("git", ["-C", home, "rev-parse", "--abbrev-ref", "HEAD"]);
    expect(stdout.trim()).toBe("main");

    await rm(bare, { recursive: true });
    await rm(seed, { recursive: true });
  }, 20000);

  it("init normalizes local branch to 'main' when remote is empty", async () => {
    const bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await execFile("git", ["init", "--bare", bare]);

    // Init local repo on 'master'
    await execFile("git", ["init", home]);
    await execFile("git", ["-C", home, "checkout", "-b", "master"]);

    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Should be normalized to 'main'
    const { stdout } = await execFile("git", ["-C", home, "rev-parse", "--abbrev-ref", "HEAD"]);
    expect(stdout.trim()).toBe("main");

    await rm(bare, { recursive: true });
  }, 15000);

  it("init accepts git@... SSH URL (validation only)", async () => {
    // Verify URL validation passes — init will fail on push (no real remote), that's OK
    const adapter = new GitAdapter(home);
    try {
      await adapter.init("git@github.com:user/repo.git");
    } catch (err) {
      // Any error is fine as long as it's NOT "Invalid remote URL"
      expect((err as Error).message).not.toContain("Invalid remote URL");
    }
  }, 15000);

  it("init succeeds when cards/ directory does not exist (fresh install)", async () => {
    // Simulate a fresh install: blow away the cards/ dir created in beforeEach.
    // The remote is pre-seeded to mirror the common case of syncing a new
    // device to an existing memex-cards repo.
    await rm(join(home, "cards"), { recursive: true });

    const bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await execFile("git", ["init", "--bare", bare]);
    const seed = await mkdtemp(join(tmpdir(), "memex-seed-"));
    await execFile("git", ["init", seed]);
    await execFile("git", ["-C", seed, "checkout", "-b", "main"]);
    await mkdir(join(seed, "cards"), { recursive: true });
    await writeFile(
      join(seed, "cards", "seed.md"),
      "---\ntitle: Seed\ncreated: 2026-03-20\n---\nseed",
      "utf-8"
    );
    await execFile("git", ["-C", seed, "add", "."]);
    await execFile("git", ["-C", seed, "commit", "-m", "seed"]);
    await execFile("git", ["-C", seed, "remote", "add", "origin", bare]);
    await execFile("git", ["-C", seed, "push", "-u", "origin", "main"]);
    await execFile("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    const config = await readSyncConfig(home);
    expect(config.remote).toBe(bare);

    await rm(bare, { recursive: true });
    await rm(seed, { recursive: true });
  }, 20000);

  it("init with branch mismatch does not create orphan remote branch (#82)", async () => {
    // Reproduce #82: remote has 'main' as default, local git defaults to 'master'.
    // After init, there should be NO orphan 'master' branch on the remote,
    // and subsequent sync (pull) should succeed without merge conflicts.
    const bare = await mkdtemp(join(tmpdir(), "memex-bare-"));
    await execFile("git", ["init", "--bare", bare]);
    const seed = await mkdtemp(join(tmpdir(), "memex-seed-"));
    await execFile("git", ["init", seed]);
    await execFile("git", ["-C", seed, "checkout", "-b", "main"]);
    await mkdir(join(seed, "cards"), { recursive: true });
    await writeFile(
      join(seed, "cards", "existing.md"),
      "---\ntitle: Existing\ncreated: 2026-04-28\n---\nexisting card",
      "utf-8"
    );
    await execFile("git", ["-C", seed, "add", "."]);
    await execFile("git", ["-C", seed, "commit", "-m", "seed"]);
    await execFile("git", ["-C", seed, "remote", "add", "origin", bare]);
    await execFile("git", ["-C", seed, "push", "-u", "origin", "main"]);
    await execFile("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

    // Local repo starts on 'master' (simulating old git default)
    await execFile("git", ["init", home]);
    await execFile("git", ["-C", home, "checkout", "-b", "master"]);

    const adapter = new GitAdapter(home);
    await adapter.init(bare);

    // Verify no orphan 'master' on remote
    const { stdout: remoteBranches } = await execFile("git", [
      "-C", bare, "branch", "--list",
    ]);
    expect(remoteBranches).not.toContain("master");
    expect(remoteBranches).toContain("main");

    // Verify subsequent sync (pull) succeeds without merge conflict
    const result = await adapter.pull();
    expect(result.success).toBe(true);

    await rm(bare, { recursive: true });
    await rm(seed, { recursive: true });
  }, 20000);

  it("init accepts https:// URL (validation only)", async () => {
    const adapter = new GitAdapter(home);
    try {
      await adapter.init("https://github.com/user/repo.git");
    } catch (err) {
      // Any error is fine as long as it's NOT "Invalid remote URL"
      expect((err as Error).message).not.toContain("Invalid remote URL");
    }
  }, 30000);
});
