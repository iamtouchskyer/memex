import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../../src/lib/config.js";

describe("readConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default config when file does not exist", async () => {
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("returns default config when file is invalid JSON", async () => {
    await writeFile(join(tmpDir, ".memexrc"), "invalid json{");
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("reads nestedSlugs: true from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: true });
  });

  it("reads nestedSlugs: false from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("treats non-boolean nestedSlugs as false", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: "yes" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("treats missing nestedSlugs field as false", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ otherField: "value" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("reads searchDirs from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true, searchDirs: ["projects", "notes"] }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: true, searchDirs: ["projects", "notes"] });
  });

  it("treats non-array searchDirs as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false, searchDirs: "projects" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false, searchDirs: undefined });
  });

  it("treats missing searchDirs field as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });
});
