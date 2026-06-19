import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

interface McpConfigResult {
  success: boolean;
  output?: string;
  error?: string;
}

const MCP_ENTRY = {
  command: "memex",
  args: ["mcp"],
};

export async function configureMcp(opts: {
  claudeCode?: boolean;
  json?: boolean;
}): Promise<McpConfigResult> {
  const mcpServers = { memex: MCP_ENTRY };

  if (opts.claudeCode) {
    return await writeClaudeCodeConfig(mcpServers);
  }

  // Default or --json: print config JSON
  const output = JSON.stringify({ mcpServers }, null, 2);
  if (opts.json) {
    return { success: true, output };
  }
  return {
    success: true,
    output: output + "\n\nAdd the above to your MCP client config.\nFor Claude Code: memex mcp-config --claude-code",
  };
}

async function writeClaudeCodeConfig(
  mcpServers: Record<string, typeof MCP_ENTRY>
): Promise<McpConfigResult> {
  const settingsPath = join(homedir(), ".claude", "settings.json");

  let settings: Record<string, unknown> = {};
  try {
    const raw = await readFile(settingsPath, "utf-8");
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  // Merge mcpServers
  const existing = (settings.mcpServers as Record<string, unknown>) || {};
  if (existing.memex) {
    return {
      success: true,
      output: `memex MCP already configured in ${settingsPath}\nCurrent config: ${JSON.stringify(existing.memex)}`,
    };
  }

  settings.mcpServers = { ...existing, ...mcpServers };

  // Write back
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

  return {
    success: true,
    output: `✓ memex MCP server added to ${settingsPath}\n\nRestart Claude Code to activate. The agent will now have access to memex_recall, memex_retro, and other memory tools.`,
  };
}
