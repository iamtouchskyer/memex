import * as vscode from "vscode";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";

function findNode(): string {
  // 1. Try VS Code's bundled Node.js (most reliable, no external dependency)
  const vscodeNode = (process as any).execPath;
  if (vscodeNode && existsSync(vscodeNode)) {
    // VS Code runs extensions via Electron which IS Node.js compatible
    // But Electron binary may not work as standalone node for CLI scripts
    // So we only use it as fallback
  }

  // 2. Try system node
  try {
    const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
    if (nodePath && existsSync(nodePath)) return nodePath;
  } catch {}

  // 3. Common Node.js install locations
  const commonPaths = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
    join(process.env.HOME || "", ".nvm/versions/node"),
  ];

  for (const p of commonPaths) {
    if (p.includes(".nvm")) {
      // Find latest nvm version
      try {
        const versions = execSync(`ls -1 "${p}"`, { encoding: "utf-8" }).trim().split("\n");
        const latest = versions.pop();
        if (latest) {
          const nvmNode = join(p, latest, "bin/node");
          if (existsSync(nvmNode)) return nvmNode;
        }
      } catch {}
    } else if (existsSync(p)) {
      return p;
    }
  }

  // 4. Fallback: hope "node" is on PATH
  return "node";
}

export function activate(context: vscode.ExtensionContext) {
  const cliPath = join(context.extensionPath, "node_modules", "@touchskyer", "memex", "dist", "cli.js");
  const nodeBin = findNode();
  const pkgJson = JSON.parse(readFileSync(join(context.extensionPath, "package.json"), "utf-8"));

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("memex.mcpServer", {
      provideMcpServerDefinitions: async () => [
        new vscode.McpStdioServerDefinition(
          "Memex",
          nodeBin,
          [cliPath, "mcp"],
          {},
          pkgJson.version
        ),
      ],
      resolveMcpServerDefinition: async (server) => server,
    })
  );
}
