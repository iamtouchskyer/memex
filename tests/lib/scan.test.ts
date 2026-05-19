import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanMarkdownFiles } from "../../src/lib/scan.js";

describe("scanMarkdownFiles", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scan-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty array for empty directory", async () => {
    expect(await scanMarkdownFiles(tmp)).toEqual([]);
  });

  it("finds a single .md file", async () => {
    await writeFile(join(tmp, "note.md"), "hello");
    const results = await scanMarkdownFiles(tmp);
    expect(results).toEqual([{ slug: "note", path: join(tmp, "note.md") }]);
  });

  it("finds .md files in nested directories", async () => {
    await mkdir(join(tmp, "sub", "deep"), { recursive: true });
    await writeFile(join(tmp, "top.md"), "a");
    await writeFile(join(tmp, "sub", "mid.md"), "b");
    await writeFile(join(tmp, "sub", "deep", "bottom.md"), "c");

    const results = await scanMarkdownFiles(tmp);
    const slugs = results.map((r) => r.slug).sort();
    expect(slugs).toEqual(["bottom", "mid", "top"]);
    expect(results.every((r) => r.path.endsWith(".md"))).toBe(true);
  });

  it("ignores non-.md files", async () => {
    await writeFile(join(tmp, "note.md"), "yes");
    await writeFile(join(tmp, "image.png"), "no");
    await writeFile(join(tmp, "readme.txt"), "no");

    const results = await scanMarkdownFiles(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("note");
  });

  it("returns empty array for missing directory", async () => {
    const results = await scanMarkdownFiles(join(tmp, "nonexistent"));
    expect(results).toEqual([]);
  });
});
