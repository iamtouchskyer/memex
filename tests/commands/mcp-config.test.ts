import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureMcp } from "../../src/commands/mcp-config.js";

describe("mcp-config command", () => {
  it("returns JSON config by default", async () => {
    const result = await configureMcp({});
    expect(result.success).toBe(true);
    expect(result.output).toContain('"memex"');
    expect(result.output).toContain('"command": "memex"');
    expect(result.output).toContain("mcp-config --claude-code");
  });

  it("returns raw JSON with --json flag", async () => {
    const result = await configureMcp({ json: true });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output!);
    expect(parsed.mcpServers.memex).toEqual({
      command: "memex",
      args: ["mcp"],
    });
  });
});
