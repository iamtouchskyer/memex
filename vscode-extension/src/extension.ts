import * as vscode from "vscode";
import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import { execSync } from "child_process";

/** Sort version strings like "v18.0.0", "v20.1.0" by semver (highest last).
 *  Canonical version with tests in src/lib/utils.ts */
function semverSort(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const pa = a.replace(/^v/, "").split(".").map(Number);
    const pb = b.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  });
}

function findNode(): string {
  const isWin = process.platform === "win32";

  // 1. Try system node via platform-appropriate command
  try {
    const whichCmd = isWin ? "where node" : "which node";
    const nodePath = execSync(whichCmd, { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
    if (nodePath && existsSync(nodePath)) return nodePath;
  } catch {}

  // 2. Common Node.js install locations (platform-specific)
  if (isWin) {
    const winPaths = [
      join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
      join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
    ];
    for (const p of winPaths) {
      if (existsSync(p)) return p;
    }
    // Windows nvm
    const nvmHome = process.env.NVM_HOME || join(process.env.APPDATA || "", "nvm");
    if (existsSync(nvmHome)) {
      try {
        const versions: string[] = readdirSync(nvmHome).filter((d: string) => d.startsWith("v"));
        const latest = semverSort(versions).pop();
        if (latest) {
          const nvmNode = join(nvmHome, latest, "node.exe");
          if (existsSync(nvmNode)) return nvmNode;
        }
      } catch {}
    }
  } else {
    const unixPaths = [
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
    ];
    for (const p of unixPaths) {
      if (existsSync(p)) return p;
    }
    // Unix nvm
    const nvmDir = join(process.env.HOME || "", ".nvm/versions/node");
    if (existsSync(nvmDir)) {
      try {
        const versions: string[] = readdirSync(nvmDir);
        const latest = semverSort(versions).pop();
        if (latest) {
          const nvmNode = join(nvmDir, latest, "bin/node");
          if (existsSync(nvmNode)) return nvmNode;
        }
      } catch {}
    }
  }

  // 3. Fallback: hope "node" is on PATH
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
