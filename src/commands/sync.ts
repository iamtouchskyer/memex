import {
  GitAdapter,
  readSyncConfig,
  writeSyncConfig,
} from "../lib/sync.js";

interface SyncOptions {
  init?: boolean;
  remote?: string;
  auto?: string; // "on" | "off"
  status?: boolean;
  action?: "push" | "pull";
}

interface SyncCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function syncCommand(
  home: string,
  opts: SyncOptions
): Promise<SyncCommandResult> {
  const adapter = new GitAdapter(home);

  if (opts.init) {
    try {
      const url = await adapter.init(opts.remote);
      return {
        success: true,
        output:
          `Sync initialized with ${url}\n\nTip: Run \`memex sync on\` to auto-sync after every write.`,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  if (opts.action === "push" || opts.action === "pull") {
    const config = await readSyncConfig(home);
    if (!config.remote) {
      return {
        success: false,
        error: "Not initialized. Run `memex sync --init` first.",
      };
    }
    const result = opts.action === "push" ? await adapter.push() : await adapter.pull();
    return {
      success: result.success,
      output: result.success ? result.message : undefined,
      error: result.success ? undefined : result.message,
    };
  }

  if (opts.auto !== undefined) {
    const config = await readSyncConfig(home);
    if (!config.remote) {
      return {
        success: false,
        error: "Not initialized. Run `memex sync --init` first.",
      };
    }
    config.auto = opts.auto === "on";
    await writeSyncConfig(home, config);
    return { success: true, output: `Auto sync ${opts.auto}.` };
  }

  if (opts.status) {
    const status = await adapter.status();
    if (!status.configured) {
      return {
        success: true,
        output: "Sync not configured. Run `memex sync --init`.",
      };
    }
    const lines = [
      `remote: ${status.remote}`,
      `adapter: ${status.adapter}`,
      `auto: ${status.auto ? "on" : "off"}`,
      `last sync: ${status.lastSync || "never"}`,
    ];
    return { success: true, output: lines.join("\n") };
  }

  // Default: sync
  const config = await readSyncConfig(home);
  if (!config.remote) {
    // Detect user state for better guidance (with timeout to avoid CI hangs)
    let hint = "";
    
    // Helper function to run commands with timeout
    const execWithTimeout = async (command: string, args: string[], timeoutMs: number = 5000): Promise<{ stdout: string }> => {
      const { execFile: execFileCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFile = promisify(execFileCb);
      
      return Promise.race([
        execFile(command, args),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Command timeout: ${command}`)), timeoutMs)
        )
      ]);
    };
    
    try {
      await execWithTimeout("gh", ["--version"], 3000);
      // gh available — check if they have an existing repo (but with timeout)
      try {
        const { stdout: user } = await execWithTimeout("gh", ["api", "user", "-q", ".login"], 5000);
        const { stdout: repoUrl } = await execWithTimeout("gh", [
          "repo", "view", `${user.trim()}/memex-cards`, "--json", "url", "-q", ".url",
        ], 5000);
        hint = `\n\nDetected existing repo: ${repoUrl.trim()}\nRun: memex sync --init`;
      } catch {
        hint = "\n\nNo existing memex-cards repo found. Run: memex sync --init\n(This will create a private GitHub repo automatically.)";
      }
    } catch {
      hint = "\n\nInstall gh CLI (https://cli.github.com) for auto-setup,\nor provide a URL: memex sync --init <git-url>";
    }
    return {
      success: false,
      error: `Sync not initialized.${hint}`,
    };
  }

  const result = await adapter.sync();
  return {
    success: result.success,
    output: result.success ? result.message : undefined,
    error: result.success ? undefined : result.message,
  };
}
