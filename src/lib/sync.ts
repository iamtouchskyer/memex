import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

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
  init(remote?: string): Promise<string>;
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
  const target = join(home, CONFIG_FILE);
  const tmp = target + "." + randomBytes(4).toString("hex") + ".tmp";
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmp, target); // atomic on POSIX
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

/** Detect the remote default branch after fetch. Falls back to main, then master. */
async function detectRemoteBranch(home: string): Promise<string> {
  // Try origin/HEAD (set by clone or `git remote set-head origin --auto`)
  try {
    const { stdout } = await execFile("git", [
      "-C", home, "rev-parse", "--abbrev-ref", "origin/HEAD",
    ]);
    const branch = stdout.trim();
    if (branch && branch !== "origin/HEAD") return branch;
  } catch { /* not set */ }
  // Probe common defaults
  for (const candidate of ["origin/main", "origin/master"]) {
    try {
      await execFile("git", ["-C", home, "rev-parse", "--verify", candidate]);
      return candidate;
    } catch { /* not found */ }
  }
  return "origin/main"; // last resort
}

export class GitAdapter implements SyncAdapter {
  constructor(private home: string) {}

  async init(remote?: string): Promise<string> {
    if (!(await gitAvailable())) {
      throw new Error("git is required for sync. Install git first.");
    }

    let url = remote;

    // Allowlist URL validation: must match a known git remote pattern
    if (url) {
      const isSchemeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);  // https://, ssh://, git://
      const isSshUrl = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:/.test(url);  // git@host:user/repo
      const isAbsolutePath = url.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(url);  // /path/to/bare-repo or C:\path
      if (!isSchemeUrl && !isSshUrl && !isAbsolutePath) {
        throw new Error(`Invalid remote URL: "${url}". Expected a git URL (e.g. git@github.com:user/repo.git or https://github.com/user/repo.git) or an absolute path.`);
      }
    }

    if (!url) {
      if (!(await ghAvailable())) {
        throw new Error(
          "Provide a repo URL or install gh CLI (https://cli.github.com)."
        );
      }
      // Check if gh is authenticated
      try {
        await execFile("gh", ["auth", "status"]);
      } catch {
        throw new Error(
          "gh CLI is not authenticated. Run `gh auth login` first."
        );
      }
      // Try to reuse existing repo first, create only if it doesn't exist
      let ghUser: string;
      try {
        const { stdout: userOut } = await execFile("gh", [
          "api", "user", "-q", ".login",
        ]);
        ghUser = userOut.trim();
      } catch {
        throw new Error("Cannot determine GitHub username. Ensure `gh auth login` is complete.");
      }
      try {
        const { stdout } = await execFile("gh", [
          "repo", "view", `${ghUser}/memex-cards`, "--json", "url", "-q", ".url",
        ]);
        url = stdout.trim();
      } catch {
        // Repo doesn't exist — create it
        const { stdout } = await execFile("gh", [
          "repo", "create", "memex-cards", "--private",
        ]);
        url = stdout.trim();
      }
      if (!url) {
        throw new Error("Failed to get repo URL from gh CLI.");
      }
    }

    // Ensure cards/ exists. `git add cards` below would otherwise fail with
    // "pathspec 'cards' did not match any files" on a fresh install where no
    // card has ever been written, aborting the whole init.
    await mkdir(join(this.home, "cards"), { recursive: true });

    // Init git repo if not already
    try {
      await execFile("git", ["-C", this.home, "rev-parse", "--git-dir"]);
    } catch {
      await execFile("git", ["init", this.home]);
    }

    // Prevent CRLF issues on Windows
    await execFile("git", ["-C", this.home, "config", "core.autocrlf", "false"]);

    // Ensure .gitignore exists with local-only files
    const gitignorePath = join(this.home, ".gitignore");
    const ignoreEntries = [".sync.json", ".last-organize"];
    try {
      const existing = await readFile(gitignorePath, "utf-8");
      const missing = ignoreEntries.filter((e) => !existing.includes(e));
      if (missing.length > 0) {
        await writeFile(gitignorePath, existing.trimEnd() + "\n" + missing.join("\n") + "\n", "utf-8");
      }
    } catch {
      await writeFile(gitignorePath, ignoreEntries.join("\n") + "\n", "utf-8");
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

    // Pre-align local branch to match remote default branch BEFORE first commit.
    // This prevents the initial commit from landing on the wrong branch
    // (e.g. master vs main) when git init.defaultBranch differs from the remote.
    let targetBranch = "main"; // fallback
    try {
      const { stdout } = await execFile("git", [
        "-C", this.home, "ls-remote", "--symref", "origin", "HEAD",
      ]);
      const match = stdout.match(/ref: refs\/heads\/(\S+)\s/);
      if (match) {
        targetBranch = match[1];
      }
    } catch {
      // ls-remote failed (empty remote or offline) — use fallback
    }

    // Set HEAD to target branch before any commits exist.
    // This ensures the first commit lands on the correct branch name
    // regardless of the local git init.defaultBranch setting.
    try {
      await execFile("git", [
        "-C", this.home, "symbolic-ref", "HEAD", `refs/heads/${targetBranch}`,
      ]);
    } catch {
      // symbolic-ref failed — will try normalizeBranch after commit
    }

    // Commit local content first
    // Stage .gitignore so there's always at least one file to commit
    // (cards/ and archive/ may be empty dirs, which git can't track).
    await execFile("git", ["-C", this.home, "add", ".gitignore"]);
    try { await execFile("git", ["-C", this.home, "add", "cards"]); } catch { /* empty or missing */ }
    try { await execFile("git", ["-C", this.home, "add", "archive"]); } catch { /* empty or missing */ }
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

    // Fetch remote — if it has existing commits, merge them before pushing
    let fetched = false;
    try {
      await execFile("git", ["-C", this.home, "fetch", "origin"]);
      fetched = true;
    } catch {
      // Fetch failed (offline / empty remote) — push will handle it
    }

    if (fetched) {
      // Safety net: normalize branch name after commit in case symbolic-ref
      // didn't take effect (e.g. repo already had commits on wrong branch).
      await this.normalizeBranch();

      // Check if remote has any commits
      try {
        const remoteBranch = await detectRemoteBranch(this.home);
        // Verify the remote branch actually exists (detectRemoteBranch may
        // return a fallback like origin/main even for empty remotes).
        await execFile("git", [
          "-C", this.home, "rev-parse", "--verify", remoteBranch,
        ]);
        // Remote has commits — merge with allow-unrelated-histories
        try {
          await execFile("git", [
            "-C", this.home, "merge", remoteBranch,
            "--allow-unrelated-histories", "--no-edit",
          ]);
        } catch (mergeErr) {
          // Merge conflict — abort and surface to user
          try { await execFile("git", ["-C", this.home, "merge", "--abort"]); } catch { /* ignore */ }
          throw new Error(
            `Merge conflict during init. Your local cards conflict with remote.\n` +
            `Run: cd ${this.home} && git fetch origin && git merge origin/main --allow-unrelated-histories\n` +
            `Then resolve conflicts and run \`memex sync --init\` again.`
          );
        }
      } catch (err) {
        if ((err as Error).message?.includes("Merge conflict")) throw err;
        // No remote branch yet — fresh repo, push will create it
      }
    }

    await execFile("git", ["-C", this.home, "push", "-u", "origin", "HEAD"]);

    await writeSyncConfig(this.home, {
      remote: url,
      adapter: "git",
      auto: false,
    });

    return url;
  }

  /**
   * Rename the local branch to match the remote's default branch,
   * or fall back to "main" if the remote is empty.
   */
  private async normalizeBranch(): Promise<void> {
    let target = "main"; // fallback for empty remotes

    // Detect remote's default branch via ls-remote --symref
    try {
      const { stdout } = await execFile("git", [
        "-C", this.home, "ls-remote", "--symref", "origin", "HEAD",
      ]);
      // Parses: "ref: refs/heads/<branch>\tHEAD"
      const match = stdout.match(/ref: refs\/heads\/(\S+)\s/);
      if (match) {
        target = match[1];
      }
    } catch {
      // ls-remote failed (empty remote or offline) — use fallback
    }

    // Get current local branch name
    try {
      const { stdout } = await execFile("git", [
        "-C", this.home, "rev-parse", "--abbrev-ref", "HEAD",
      ]);
      const current = stdout.trim();
      if (current && current !== target) {
        await execFile("git", ["-C", this.home, "branch", "-M", target]);
      }
    } catch {
      // No commits yet or detached HEAD — branch -M will work after first commit
    }
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
      const remoteBranch = await detectRemoteBranch(this.home);
      await execFile("git", ["-C", this.home, "merge", remoteBranch, "--no-edit"]);
    } catch {
      // Merge conflict — auto-resolve: keep ours, save theirs as conflict copies
      const resolved = await this.autoResolveConflicts();
      if (resolved.length > 0) {
        return {
          success: true,
          message: `Pulled with conflicts auto-resolved. ${resolved.length} conflict file(s) saved: ${resolved.join(", ")}`,
        };
      }
      // If auto-resolve failed (non-card conflicts or unexpected state), abort
      try { await execFile("git", ["-C", this.home, "merge", "--abort"]); } catch { /* ignore */ }
      return {
        success: false,
        message: "Merge conflict. Run `cd " + this.home + " && git status` to see conflicting files, resolve them, then `git add . && git commit`.",
      };
    }
    return { success: true, message: "Pulled latest." };
  }

  /**
   * Auto-resolve merge conflicts by keeping local (ours) and saving remote (theirs)
   * as <slug>-conflict-<timestamp>.md. Returns list of conflict copy filenames.
   * If any file cannot be resolved, aborts and returns empty array.
   */
  private async autoResolveConflicts(): Promise<string[]> {
    // List conflicted files
    let conflictFiles: string[];
    try {
      const { stdout } = await execFile("git", [
        "-C", this.home, "diff", "--name-only", "--diff-filter=U",
      ]);
      conflictFiles = stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
    if (conflictFiles.length === 0) return [];

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const conflictCopies: string[] = [];

    for (const relPath of conflictFiles) {
      // Only auto-resolve .md files in cards/ or archive/
      if (!relPath.endsWith(".md") || !(relPath.startsWith("cards/") || relPath.startsWith("archive/"))) {
        return []; // Non-card conflict — bail out, let user handle
      }

      // Save theirs version as conflict copy
      try {
        const { stdout: theirsContent } = await execFile("git", [
          "-C", this.home, "show", `:3:${relPath}`,
        ]);
        const conflictName = relPath.replace(/\.md$/, `-conflict-${timestamp}.md`);
        const conflictPath = join(this.home, conflictName);
        await mkdir(dirname(conflictPath), { recursive: true });
        await writeFile(conflictPath, theirsContent, "utf-8");
        conflictCopies.push(conflictName);
      } catch {
        // :3: (theirs) doesn't exist = deleted on remote side, just keep ours
      }

      // Checkout ours for the conflicted file
      try {
        await execFile("git", ["-C", this.home, "checkout", "--ours", relPath]);
        await execFile("git", ["-C", this.home, "add", relPath]);
      } catch {
        return []; // Can't resolve — bail
      }
    }

    // Stage conflict copies and commit
    try {
      for (const copy of conflictCopies) {
        await execFile("git", ["-C", this.home, "add", copy]);
      }
      await execFile("git", ["-C", this.home, "commit", "--no-edit"]);
    } catch {
      return []; // Commit failed — bail
    }

    return conflictCopies;
  }

  async push(): Promise<SyncResult> {
    const config = await readSyncConfig(this.home);
    if (!config.remote) {
      return { success: false, message: "Not configured." };
    }
    // Scope add to cards/ and archive/ only (don't stage unrelated files in ~/.memex)
    try { await execFile("git", ["-C", this.home, "add", "cards"]); } catch { /* empty or missing */ }
    try { await execFile("git", ["-C", this.home, "add", "archive"]); } catch { /* empty or missing */ }
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

    // Fallback: if .sync.json has no remote, check git remote directly
    let remote = config.remote;
    if (!remote) {
      try {
        const { stdout } = await execFile("git", [
          "-C", this.home, "remote", "get-url", "origin",
        ]);
        remote = stdout.trim() || undefined;
        // Self-heal: persist the discovered remote into .sync.json
        if (remote) {
          config.remote = remote;
          await writeSyncConfig(this.home, config);
        }
      } catch {
        // No git remote configured — genuinely unconfigured
      }
    }

    return {
      configured: !!remote,
      remote,
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
