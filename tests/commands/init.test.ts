import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "memex-init-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true });
});

describe("initCommand", () => {
  it("creates AGENTS.md when it does not exist", async () => {
    const result = await initCommand(tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Created");

    const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("## Memory (memex)");
    expect(content).toContain("memex_search");
    expect(content).toContain("memex_sync");
  });

  it("appends to existing AGENTS.md", async () => {
    await writeFile(join(tmpDir, "AGENTS.md"), "# My Project\n\nSome existing rules.\n");
    const result = await initCommand(tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Appended");

    const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("## Memory (memex)");
  });

  it("skips if memex section already exists", async () => {
    await writeFile(join(tmpDir, "AGENTS.md"), "## Memory (memex)\n\nAlready here.\n");
    const result = await initCommand(tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("already has");
  });
});
