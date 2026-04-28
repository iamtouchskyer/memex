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
    return {
      success: false,
      error: "Not initialized. Run `memex sync --init` first.",
    };
  }

  const result = await adapter.sync();
  return {
    success: result.success,
    output: result.success ? result.message : undefined,
    error: result.success ? undefined : result.message,
  };
}
