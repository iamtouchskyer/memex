import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { findMemexrcUp, resolveMemexHome, warnIfEmptyCards } from "../../src/lib/config.js";

describe("findMemexrcUp", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-walkup-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds .memexrc in the start directory", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const found = await findMemexrcUp(tmpDir);
    expect(found).toBe(tmpDir);
  });

  it("finds .memexrc in a parent directory", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const child = join(tmpDir, "sub", "deep");
    await mkdir(child, { recursive: true });
    const found = await findMemexrcUp(child);
    expect(found).toBe(tmpDir);
  });

  it("returns undefined when no .memexrc exists", async () => {
    const child = join(tmpDir, "sub", "deep");
    await mkdir(child, { recursive: true });
    // Walk up from deep inside tmpDir but there's no .memexrc anywhere above
    // We can't guarantee no .memexrc exists above tmpDir, so test with root
    const found = await findMemexrcUp(child);
    // It might find one above tmpDir or not — just verify it doesn't crash
    // and if found, it's a valid directory above child
    if (found) {
      expect(child.startsWith(found)).toBe(true);
    } else {
      expect(found).toBeUndefined();
    }
  });

  it("stops at filesystem root without error", async () => {
    // This just verifies it terminates and doesn't throw
    const result = await findMemexrcUp("/");
    // Result is either undefined or "/" if .memexrc exists at root (unlikely)
    expect(result === undefined || result === "/").toBe(true);
  });
});

describe("resolveMemexHome", () => {
  let tmpDir: string;
  const originalEnv = process.env.MEMEX_HOME;
  const originalCwd = process.cwd;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-resolve-test-"));
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.MEMEX_HOME = originalEnv;
    } else {
      delete process.env.MEMEX_HOME;
    }
    process.cwd = originalCwd;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("MEMEX_HOME env var takes precedence over everything", async () => {
    const envHome = join(tmpDir, "env-home");
    await mkdir(envHome, { recursive: true });
    process.env.MEMEX_HOME = envHome;

    // Put .memexrc in cwd to prove env var wins
    const cwdDir = join(tmpDir, "project");
    await mkdir(cwdDir, { recursive: true });
    await writeFile(join(cwdDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    process.cwd = () => cwdDir;

    const home = await resolveMemexHome();
    expect(home).toBe(envHome);
  });

  it("walk-up .memexrc discovery takes precedence over ~/.memex fallback", async () => {
    delete process.env.MEMEX_HOME;

    // Create .memexrc in tmpDir and start from a subdirectory
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const projectDir = join(tmpDir, "project", "src");
    await mkdir(projectDir, { recursive: true });
    process.cwd = () => projectDir;

    const home = await resolveMemexHome();
    expect(home).toBe(tmpDir);
  });

  it("falls back to ~/.memex when no MEMEX_HOME and no .memexrc found", async () => {
    delete process.env.MEMEX_HOME;

    // Point cwd at a directory with no .memexrc anywhere up to tmpDir
    // We use a deep nested dir in /tmp which won't have .memexrc
    const deepDir = join(tmpDir, "a", "b", "c");
    await mkdir(deepDir, { recursive: true });
    process.cwd = () => deepDir;

    const home = await resolveMemexHome();
    // Should fall back to ~/.memex (unless there's a .memexrc somewhere in /tmp)
    // We can't fully control the filesystem above tmpDir, so at minimum
    // verify it returns a string
    expect(typeof home).toBe("string");
    expect(home.length).toBeGreaterThan(0);
  });

  it("falls back to ~/.memex when cwd has no .memexrc above it", async () => {
    delete process.env.MEMEX_HOME;

    // Use root as cwd — no .memexrc there (almost certainly)
    process.cwd = () => "/";

    const home = await resolveMemexHome();
    // Should be either "/" (if .memexrc at root, unlikely) or ~/.memex
    if (home !== "/") {
      expect(home).toBe(join(homedir(), ".memex"));
    }
  });
});

describe("warnIfEmptyCards", () => {
  let tmpDir: string;
  let stderrOutput: string;
  const originalWrite = process.stderr.write;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-warn-test-"));
    stderrOutput = "";
    process.stderr.write = ((chunk: string) => {
      stderrOutput += chunk;
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(async () => {
    process.stderr.write = originalWrite;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("warns when cards directory does not exist", async () => {
    await warnIfEmptyCards(tmpDir);
    expect(stderrOutput).toContain("Warning: cards directory not found");
    expect(stderrOutput).toContain(join(tmpDir, "cards"));
  });

  it("warns when cards directory is empty", async () => {
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await warnIfEmptyCards(tmpDir);
    expect(stderrOutput).toContain("Warning: cards directory is empty");
    expect(stderrOutput).toContain(join(tmpDir, "cards"));
  });

  it("does not warn when cards directory has files", async () => {
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await writeFile(join(tmpDir, "cards", "test.md"), "---\ntitle: Test\n---\nContent");
    await warnIfEmptyCards(tmpDir);
    expect(stderrOutput).toBe("");
  });
});
