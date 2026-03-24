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
});
