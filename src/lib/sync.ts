import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---- Types ----

export interface SyncConfig {
  remote?: string;
  adapter: string;
  auto: boolean;
  lastSync?: string;
}

export interface SyncResult {
  success: boolean;
  message: string;
}

export interface SyncStatus {
  configured: boolean;
  remote?: string;
  adapter: string;
  auto: boolean;
  lastSync?: string;
}

export interface SyncAdapter {
  init(remote?: string): Promise<void>;
  pull(): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  sync(): Promise<SyncResult>;
  status(): Promise<SyncStatus>;
}

// ---- Config ----

const CONFIG_FILE = ".sync.json";

export async function readSyncConfig(home: string): Promise<SyncConfig> {
  try {
    const raw = await readFile(join(home, CONFIG_FILE), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { adapter: "git", auto: false };
  }
}

export async function writeSyncConfig(
  home: string,
  config: SyncConfig
): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, CONFIG_FILE),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

// ---- Git helpers ----

async function gitAvailable(): Promise<boolean> {
  try {
    await execFile("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function ghAvailable(): Promise<boolean> {
  try {
    await execFile("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

// ---- GitAdapter ----

export class GitAdapter implements SyncAdapter {
  constructor(private home: string) {}

  async init(remote?: string): Promise<void> {
    if (!(await gitAvailable())) {
      throw new Error("git is required for sync. Install git first.");
    }

    let url = remote;

    if (!url) {
      if (!(await ghAvailable())) {
        throw new Error(
          "Provide a repo URL or install gh CLI (https://cli.github.com)."
        );
      }
      const { stdout } = await execFile("gh", [
        "repo",
        "create",
        "memex-cards",
        "--private",
      ]);
      url = stdout.trim();
    }

    // Init git repo if not already
    try {
      await execFile("git", ["-C", this.home, "rev-parse", "--git-dir"]);
    } catch {
      await execFile("git", ["init", this.home]);
    }

    // Set remote
    try {
      await execFile("git", ["-C", this.home, "remote", "add", "origin", url]);
    } catch (err) {
      if ((err as Error).message?.includes("already exists")) {
        await execFile("git", [
          "-C",
          this.home,
          "remote",
          "set-url",
          "origin",
          url,
        ]);
      } else {
        throw err;
      }
    }

    // Initial commit and push
    await execFile("git", ["-C", this.home, "add", "-A"]);
    try {
      await execFile("git", [
        "-C",
        this.home,
        "commit",
        "-m",
        "memex: initial sync",
      ]);
    } catch {
      // Nothing to commit is OK
    }
    await execFile("git", ["-C", this.home, "push", "-u", "origin", "HEAD"]);

    await writeSyncConfig(this.home, {
      remote: url,
      adapter: "git",
      auto: false,
    });
  }

  async pull(): Promise<SyncResult> {
    const config = await readSyncConfig(this.home);
    if (!config.remote) {
      return { success: false, message: "Not configured." };
    }
    try {
      await execFile("git", ["-C", this.home, "fetch", "origin"]);
    } catch {
      return { success: true, message: "Offline, using local data." };
    }
    try {
      await execFile("git", ["-C", this.home, "merge", "origin/main", "--no-edit"]);
    } catch {
      try { await execFile("git", ["-C", this.home, "merge", "--abort"]); } catch { /* ignore */ }
      return { success: false, message: "Merge conflict. Resolve manually in " + this.home };
    }
    return { success: true, message: "Pulled latest." };
  }

  async push(): Promise<SyncResult> {
    const config = await readSyncConfig(this.home);
    if (!config.remote) {
      return { success: false, message: "Not configured." };
    }
    await execFile("git", ["-C", this.home, "add", "-A"]);
    try {
      const ts = new Date().toISOString();
      await execFile("git", ["-C", this.home, "commit", "-m", `memex sync ${ts}`]);
    } catch { /* Nothing to commit */ }
    try {
      await execFile("git", ["-C", this.home, "push", "origin", "HEAD"]);
    } catch (err) {
      return { success: false, message: `Push failed: ${(err as Error).message}` };
    }
    config.lastSync = new Date().toISOString();
    await writeSyncConfig(this.home, config);
    return { success: true, message: "Pushed." };
  }

  async sync(): Promise<SyncResult> {
    const pullResult = await this.pull();
    if (!pullResult.success) return pullResult;
    return this.push();
  }

  async status(): Promise<SyncStatus> {
    const config = await readSyncConfig(this.home);
    return {
      configured: !!config.remote,
      remote: config.remote,
      adapter: config.adapter,
      auto: config.auto,
      lastSync: config.lastSync,
    };
  }
}

// ---- Auto-sync helper ----

export async function autoSync(home: string): Promise<void> {
  const config = await readSyncConfig(home);
  if (!config.auto || !config.remote) return;
  try {
    const adapter = new GitAdapter(home);
    await adapter.sync();
  } catch (err) {
    process.stderr.write(`sync warning: ${(err as Error).message}\n`);
  }
}

export async function autoFetch(home: string): Promise<void> {
  const config = await readSyncConfig(home);
  if (!config.remote) return; // silent no-op
  try {
    const adapter = new GitAdapter(home);
    await adapter.pull();
  } catch {
    // silent — infrastructure, not business logic
  }
}
