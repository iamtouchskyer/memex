import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CardStore } from "../../src/lib/store.js";
import { parseFlomoHtml, flomoImportCommand } from "../../src/commands/flomo.js";
import { parseFrontmatter } from "../../src/lib/parser.js";

// Sample flomo HTML export
const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>flomo export</title></head>
<body>
<div class="memos">
<div class="memo">
<div class="time">2024-06-15 10:30:00</div>
<div class="content"><p>这是一条关于 #产品设计 的思考</p><p>用户体验是最重要的</p></div>
<div class="files"></div>
</div>
<div class="memo">
<div class="time">2024-06-16 14:20:00</div>
<div class="content"><p>Reading notes: <b>Thinking, Fast and Slow</b></p><p>System 1 vs System 2 #reading #psychology</p></div>
<div class="files"></div>
</div>
<div class="memo">
<div class="time">2024-06-17 09:00:00</div>
<div class="content"><p>Simple memo without tags</p></div>
<div class="files"></div>
</div>
</div>
</body>
</html>`;

describe("parseFlomoHtml", () => {
  it("extracts memos from valid HTML", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos.length).toBe(3);
  });

  it("extracts timestamps", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos[0].timestamp).toBe("2024-06-15 10:30:00");
    expect(memos[1].timestamp).toBe("2024-06-16 14:20:00");
  });

  it("converts HTML to markdown", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos[1].content).toContain("**Thinking, Fast and Slow**");
  });

  it("extracts hashtags as tags", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos[0].tags).toContain("产品设计");
    expect(memos[1].tags).toContain("reading");
    expect(memos[1].tags).toContain("psychology");
    expect(memos[2].tags).toEqual([]);
  });

  it("generates slugs from content", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos[1].slug).toMatch(/reading-notes/);
    expect(memos[2].slug).toMatch(/simple-memo/);
  });

  it("generates titles from first line", () => {
    const memos = parseFlomoHtml(SAMPLE_HTML);
    expect(memos[2].title).toBe("Simple memo without tags");
  });

  it("returns empty array for non-flomo HTML", () => {
    const memos = parseFlomoHtml("<html><body><p>Not flomo</p></body></html>");
    expect(memos).toEqual([]);
  });

  it("handles HTML entities", () => {
    const html = `<div class="memos"><div class="memo"><div class="time">2024-01-01 00:00:00</div><div class="content"><p>A &amp; B &lt; C</p></div><div class="files"></div></div></div>`;
    const memos = parseFlomoHtml(html);
    expect(memos.length).toBe(1);
    expect(memos[0].content).toContain("A & B < C");
  });
});

// ── Import command tests ────────────────────────────────────────────

let testDir: string;
let cardsDir: string;
let archiveDir: string;
let store: CardStore;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "memex-flomo-import-"));
  cardsDir = join(testDir, "cards");
  archiveDir = join(testDir, "archive");
  await mkdir(cardsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  store = new CardStore(cardsDir, archiveDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("flomoImportCommand", () => {
  it("imports memos as cards", async () => {
    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    const result = await flomoImportCommand(store, htmlPath, {});
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("3 created");

    // Verify cards were written
    const cards = await store.scanAll();
    expect(cards.length).toBe(3);
  });

  it("marks imported cards with source: flomo", async () => {
    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    await flomoImportCommand(store, htmlPath, {});

    const cards = await store.scanAll();
    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { data } = parseFrontmatter(raw);
      expect(data.source).toBe("flomo");
    }
  });

  it("dry-run does not create cards", async () => {
    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    const result = await flomoImportCommand(store, htmlPath, { dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("would create");

    const cards = await store.scanAll();
    expect(cards.length).toBe(0);
  });

  it("skips existing slugs", async () => {
    // Pre-create a card that will conflict
    const memos = parseFlomoHtml(SAMPLE_HTML);
    const conflictSlug = memos[0].slug;
    await store.writeCard(conflictSlug, "---\ntitle: Existing\ncreated: 2024-01-01\nsource: manual\n---\nExisting content");

    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    const result = await flomoImportCommand(store, htmlPath, {});
    expect(result.exitCode).toBe(0);
    // Should use -flomo suffix for the conflicting one
    const cards = await store.scanAll();
    expect(cards.length).toBe(4); // 1 existing + 3 imported (conflict uses -flomo suffix)
  });

  it("returns error for missing file", async () => {
    const result = await flomoImportCommand(store, "/nonexistent/file.html", {});
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Cannot read file");
  });

  it("returns error for non-flomo HTML", async () => {
    const htmlPath = join(testDir, "bad.html");
    await writeFile(htmlPath, "<html><body>Not flomo</body></html>");

    const result = await flomoImportCommand(store, htmlPath, {});
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No memos found");
  });

  it("preserves timestamps as created date", async () => {
    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    await flomoImportCommand(store, htmlPath, {});

    const cards = await store.scanAll();
    const card = cards.find(c => c.slug.includes("reading"));
    expect(card).toBeDefined();
    const raw = await store.readCard(card!.slug);
    const { data } = parseFrontmatter(raw);
    const created = data.created instanceof Date
      ? data.created.toISOString().split("T")[0]
      : String(data.created);
    expect(created).toBe("2024-06-16");
  });

  it("includes tags in frontmatter", async () => {
    const htmlPath = join(testDir, "export.html");
    await writeFile(htmlPath, SAMPLE_HTML);

    await flomoImportCommand(store, htmlPath, {});

    const cards = await store.scanAll();
    const card = cards.find(c => c.slug.includes("reading"));
    expect(card).toBeDefined();
    const raw = await store.readCard(card!.slug);
    const { data } = parseFrontmatter(raw);
    expect(String(data.tags)).toContain("reading");
    expect(String(data.tags)).toContain("psychology");
  });
});
