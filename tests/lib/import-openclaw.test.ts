import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";
import matter from "gray-matter";
import {
  slugify,
  extractH2Sections,
  extractDateFromFilename,
  yamlEscape,
  buildCard,
  generateSlugs,
  OpenClawImporter,
} from "../../src/importers/openclaw.js";
import { CardStore } from "../../src/lib/store.js";

describe("slugify", () => {
  it("converts to lowercase kebab-case", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("preserves Chinese characters", () => {
    expect(slugify("论文综述")).toBe("论文综述");
  });

  it("handles mixed Chinese and English", () => {
    expect(slugify("Bug修复 phase_runner")).toBe("bug修复-phase_runner");
  });

  it("removes special characters", () => {
    expect(slugify("title: with #special! chars")).toBe("title-with-special-chars");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(80);
  });

  it("collapses multiple dashes", () => {
    expect(slugify("a - - b")).toBe("a-b");
  });
});

describe("extractH2Sections", () => {
  it("extracts multiple H2 sections", () => {
    const content = `# Title
## Section One
Body one.
## Section Two
Body two.
`;
    const sections = extractH2Sections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Section One");
    expect(sections[0].body).toBe("Body one.");
    expect(sections[1].title).toBe("Section Two");
    expect(sections[1].body).toBe("Body two.");
  });

  it("returns empty array when no H2 sections", () => {
    const content = `# Only H1\nSome paragraph.\n`;
    expect(extractH2Sections(content)).toHaveLength(0);
  });

  it("handles content before first H2", () => {
    const content = `Intro text\n## First\nBody\n`;
    const sections = extractH2Sections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("First");
  });

  it("preserves multi-line body", () => {
    const content = `## Topic\nLine 1\nLine 2\n\nLine 3\n`;
    const sections = extractH2Sections(content);
    expect(sections[0].body).toContain("Line 1\nLine 2\n\nLine 3");
  });
});

describe("extractDateFromFilename", () => {
  it("extracts YYYY-MM-DD from filename", () => {
    expect(extractDateFromFilename("2026-03-19.md")).toBe("2026-03-19");
  });

  it("extracts date from prefixed filename", () => {
    expect(extractDateFromFilename("2026-03-19-notes.md")).toBe("2026-03-19");
  });

  it("returns null for non-date filenames", () => {
    expect(extractDateFromFilename("seedance-course.md")).toBeNull();
  });
});

describe("yamlEscape", () => {
  it("returns plain string when no special chars", () => {
    expect(yamlEscape("simple title")).toBe("simple title");
  });

  it("quotes strings with colons", () => {
    expect(yamlEscape("Bug修复：something")).toBe('"Bug修复：something"');
  });

  it("quotes strings with hash", () => {
    expect(yamlEscape("Section #1")).toBe('"Section #1"');
  });

  it("quotes strings with brackets", () => {
    expect(yamlEscape("[tagged]")).toBe('"[tagged]"');
  });
});

describe("buildCard", () => {
  it("generates valid frontmatter with date", () => {
    const card = buildCard("2026-03-19", "Test Title", "Body text", []);
    const { data, content } = matter(card);
    expect(data.title).toBe("Test Title");
    expect(data.created).toBe("2026-03-19");
    expect(typeof data.created).toBe("string");
    expect(data.source).toBe("openclaw");
    expect(data.tags).toContain("openclaw-memory");
    expect(content.trim()).toBe("Body text");
  });

  it("keeps date as string in tags (not Date object)", () => {
    const card = buildCard("2026-03-19", "Test", "Body", []);
    const { data } = matter(card);
    for (const tag of data.tags) {
      expect(typeof tag).toBe("string");
    }
  });

  it("escapes YAML special chars in title", () => {
    const card = buildCard("2026-03-19", "Bug修复：phase_runner", "Body", []);
    const { data } = matter(card);
    expect(data.title).toBe("Bug修复：phase_runner");
  });

  it("adds wikilinks for siblings", () => {
    const card = buildCard("2026-03-19", "A", "Body", ["slug-b", "slug-c"]);
    expect(card).toContain("[[slug-b]]");
    expect(card).toContain("[[slug-c]]");
  });

  it("no related line when no siblings", () => {
    const card = buildCard("2026-03-19", "A", "Body", []);
    expect(card).not.toContain("Related:");
  });
});

describe("generateSlugs", () => {
  it("generates date-prefixed slugs", () => {
    const sections = [{ title: "Topic One", body: "" }, { title: "Topic Two", body: "" }];
    const slugs = generateSlugs(sections, "2026-03-19", "fallback");
    expect(slugs[0]).toBe("2026-03-19-topic-one");
    expect(slugs[1]).toBe("2026-03-19-topic-two");
  });

  it("uses fallback name when no date", () => {
    const sections = [{ title: "", body: "" }];
    const slugs = generateSlugs(sections, null, "some-file");
    expect(slugs[0]).toBe("some-file-section-0");
  });

  it("deduplicates slugs for repeated H2 titles", () => {
    const sections = [
      { title: "Progress", body: "Morning" },
      { title: "Progress", body: "Afternoon" },
      { title: "Progress", body: "Evening" },
    ];
    const slugs = generateSlugs(sections, "2026-03-19", "fallback");
    expect(slugs[0]).toBe("2026-03-19-progress");
    expect(slugs[1]).toBe("2026-03-19-progress-2");
    expect(slugs[2]).toBe("2026-03-19-progress-3");
    // All unique
    expect(new Set(slugs).size).toBe(3);
  });
});

describe("OpenClawImporter (integration)", () => {
  let memexHome: string;
  let memoryDir: string;
  let store: InstanceType<typeof CardStore>;
  const importer = new OpenClawImporter();

  beforeEach(async () => {
    memexHome = await mkdtemp(join(tmpdir(), "memex-import-"));
    memoryDir = await mkdtemp(join(tmpdir(), "openclaw-mem-"));
    await mkdir(join(memexHome, "cards"), { recursive: true });
    await mkdir(join(memexHome, "archive"), { recursive: true });
    store = new CardStore(join(memexHome, "cards"), join(memexHome, "archive"));
  });

  afterEach(async () => {
    await rm(memexHome, { recursive: true });
    await rm(memoryDir, { recursive: true });
  });

  it("imports H2 sections as separate cards", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day
## Topic A
Body A
## Topic B
Body B
`);

    const result = await importer.run({
      store,
      sourceDir: memoryDir,
      onLog: () => {},
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const cards = readdirSync(join(memexHome, "cards"));
    expect(cards).toHaveLength(2);
    expect(cards.some(c => c.includes("topic-a"))).toBe(true);
    expect(cards.some(c => c.includes("topic-b"))).toBe(true);
  });

  it("creates wikilinks between same-day cards", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day
## Alpha
Content A
## Beta
Content B
`);

    await importer.run({ store, sourceDir: memoryDir, onLog: () => {} });

    const alphaFile = readdirSync(join(memexHome, "cards")).find(f => f.includes("alpha"))!;
    const content = await readFile(join(memexHome, "cards", alphaFile), "utf-8");
    expect(content).toContain("[[2026-03-19-beta]]");
  });

  it("skips files without H2 sections", async () => {
    await writeFile(join(memoryDir, "2026-02-14.md"), "# No H2 here\nJust text.\n");

    const result = await importer.run({
      store,
      sourceDir: memoryDir,
      onLog: () => {},
    });

    expect(result.created).toBe(0);
    expect(readdirSync(join(memexHome, "cards"))).toHaveLength(0);
  });

  it("is idempotent (skips existing cards)", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day\n## Topic\nBody\n`);

    await importer.run({ store, sourceDir: memoryDir, onLog: () => {} });
    const result2 = await importer.run({ store, sourceDir: memoryDir, onLog: () => {} });

    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it("dry-run does not write files", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day\n## Topic\nBody\n`);

    const result = await importer.run({
      store,
      sourceDir: memoryDir,
      dryRun: true,
      onLog: () => {},
    });

    expect(result.created).toBe(1);
    expect(readdirSync(join(memexHome, "cards"))).toHaveLength(0);
  });

  it("generates valid frontmatter parseable by gray-matter", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day
## Bug修复：phase_runner 无限循环
Fixed the bug.
`);

    await importer.run({ store, sourceDir: memoryDir, onLog: () => {} });

    const files = readdirSync(join(memexHome, "cards"));
    const raw = await readFile(join(memexHome, "cards", files[0]), "utf-8");
    const { data } = matter(raw);

    expect(data.title).toBe("Bug修复：phase_runner 无限循环");
    expect(typeof data.created).toBe("string");
    expect(data.source).toBe("openclaw");
  });

  it("does not silently drop sections with duplicate H2 titles", async () => {
    await writeFile(join(memoryDir, "2026-03-19.md"), `# Day
## Progress
Morning update
## Other
Something else
## Progress
Afternoon update
`);

    const result = await importer.run({ store, sourceDir: memoryDir, onLog: () => {} });

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);

    const cards = readdirSync(join(memexHome, "cards"));
    expect(cards).toHaveLength(3);

    // Both "Progress" sections should exist as separate cards
    const progressCards = cards.filter(c => c.includes("progress"));
    expect(progressCards).toHaveLength(2);

    // Content should be different
    const contents = await Promise.all(
      progressCards.map(c => readFile(join(memexHome, "cards", c), "utf-8"))
    );
    const bodies = contents.map(c => matter(c).content);
    expect(bodies.some(b => b.includes("Morning update"))).toBe(true);
    expect(bodies.some(b => b.includes("Afternoon update"))).toBe(true);
  });
});
