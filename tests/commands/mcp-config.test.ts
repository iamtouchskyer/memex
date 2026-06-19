import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("mcp-config --claude-code", () => {
  let tempHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "memex-mcp-config-"));
    // Override homedir() by setting HOME env var
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempHome, { recursive: true, force: true });
  });

  it("creates settings.json when file does not exist", async () => {
    const result = await configureMcp({ claudeCode: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain("memex MCP server added");

    const settingsPath = join(tempHome, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.mcpServers.memex).toEqual({
      command: "memex",
      args: ["mcp"],
    });
  });

  it("merges into existing settings without overwriting other keys", async () => {
    const settingsDir = join(tempHome, ".claude");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        model: "opus",
        mcpServers: { other: { command: "other-tool", args: [] } },
      }),
      "utf-8"
    );

    const result = await configureMcp({ claudeCode: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain("memex MCP server added");

    const settings = JSON.parse(
      await readFile(join(settingsDir, "settings.json"), "utf-8")
    );
    // Existing keys preserved
    expect(settings.model).toBe("opus");
    expect(settings.mcpServers.other).toEqual({ command: "other-tool", args: [] });
    // memex added
    expect(settings.mcpServers.memex).toEqual({
      command: "memex",
      args: ["mcp"],
    });
  });

  it("reports already configured when memex entry exists", async () => {
    const settingsDir = join(tempHome, ".claude");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        mcpServers: { memex: { command: "memex", args: ["mcp"] } },
      }),
      "utf-8"
    );

    const result = await configureMcp({ claudeCode: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain("already configured");
  });

  it("is idempotent — running twice does not duplicate config", async () => {
    // First run creates
    await configureMcp({ claudeCode: true });
    // Second run reports existing
    const result = await configureMcp({ claudeCode: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain("already configured");

    const settings = JSON.parse(
      await readFile(join(tempHome, ".claude", "settings.json"), "utf-8")
    );
    // Only one memex entry
    expect(Object.keys(settings.mcpServers)).toEqual(["memex"]);
  });

  it("creates .claude directory if it does not exist", async () => {
    // tempHome has no .claude dir yet
    const result = await configureMcp({ claudeCode: true });
    expect(result.success).toBe(true);

    const raw = await readFile(join(tempHome, ".claude", "settings.json"), "utf-8");
    expect(JSON.parse(raw).mcpServers.memex).toBeDefined();
  });
});
