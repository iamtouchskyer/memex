import { describe, it, expect } from "vitest";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exec = promisify(execFile);

function runMcp(home: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", "mcp"], {
      env: { ...process.env, MEMEX_HOME: home },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`MCP server did not exit. stderr:\n${stderr}`));
    }, 5000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`MCP server exited with ${code}. stderr:\n${stderr}`));
    });
    child.stdin.end();
  });
}

describe("memex mcp subcommand", () => {
  it("memex mcp --help shows MCP description", async () => {
    const { stdout } = await exec("node", ["dist/cli.js", "mcp", "--help"]);
    expect(stdout).toContain("MCP");
  });

  it("memex mcp starts from the bundled CLI", async () => {
    const home = await mkdtemp(join(tmpdir(), "memex-cli-mcp-"));
    try {
      const stderr = await runMcp(home);
      expect(stderr).toContain("memex MCP server running on stdio");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
