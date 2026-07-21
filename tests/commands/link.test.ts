import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";
import { linkCommand } from "../../src/commands/link.js";
import { extractLinks, parseFrontmatter } from "../../src/lib/parser.js";

describe("linkCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-link-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function card(slug: string, body: string): Promise<void> {
    await writeFile(
      join(tmpDir, "cards", `${slug}.md`),
      `---\ntitle: ${slug}\ncreated: 2026-01-01\nmodified: 2026-01-01\nsource: test\n---\n${body}`,
    );
  }

  it("appends an outbound link from → to", async () => {
    await card("from", "Some content.");
    await card("to", "Target content.");

    const result = await linkCommand(store, "from", "to", "Builds on");
    expect(result.success).toBe(true);

    const raw = await readFile(join(tmpDir, "cards", "from.md"), "utf-8");
    const { content } = parseFrontmatter(raw);
    expect(extractLinks(content)).toContain("to");
  });

  it("embeds the relationship context in a sentence with the link", async () => {
    await card("from", "Some content.");
    await card("to", "Target content.");

    await linkCommand(store, "from", "to", "Extends the idea in");

    const raw = await readFile(join(tmpDir, "cards", "from.md"), "utf-8");
    const { content } = parseFrontmatter(raw);
    // Methodology: links must live in a sentence explaining the relationship.
    expect(content).toContain("Extends the idea in [[to]]");
    // The bare "Related:" anti-pattern must not be used.
    expect(content).not.toContain("Related: [[to]]");
  });

  it("rejects an empty relationship context", async () => {
    await card("from", "Some content.");
    await card("to", "Target content.");

    const result = await linkCommand(store, "from", "to", "   ");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/relationship|context|why/i);
  });

  it("does NOT modify the target card", async () => {
    await card("from", "Some content.");
    await card("to", "Target content.");
    const before = await readFile(join(tmpDir, "cards", "to.md"), "utf-8");

    await linkCommand(store, "from", "to", "See also");

    const after = await readFile(join(tmpDir, "cards", "to.md"), "utf-8");
    expect(after).toBe(before);
  });

  it("is idempotent when the link already exists", async () => {
    await card("from", "Already links [[to]] here.");
    await card("to", "Target content.");

    const result = await linkCommand(store, "from", "to", "Builds on");
    expect(result.success).toBe(true);

    const raw = await readFile(join(tmpDir, "cards", "from.md"), "utf-8");
    const { content } = parseFrontmatter(raw);
    const count = extractLinks(content).filter((l) => l === "to").length;
    expect(count).toBe(1);
  });

  it("is idempotent when a basename alias already links the target (nested slugs)", async () => {
    const nestedStore = new CardStore(
      join(tmpDir, "cards"),
      join(tmpDir, "archive"),
      true,
    );
    await mkdir(join(tmpDir, "cards", "topics"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "src.md"),
      `---\ntitle: src\ncreated: 2026-01-01\nsource: test\n---\nRefers to [[target]] already.`,
    );
    await writeFile(
      join(tmpDir, "cards", "topics", "target.md"),
      `---\ntitle: target\ncreated: 2026-01-01\nsource: test\n---\nBody.`,
    );

    const result = await linkCommand(nestedStore, "src", "topics/target", "Builds on");
    expect(result.success).toBe(true);

    const raw = await readFile(join(tmpDir, "cards", "src.md"), "utf-8");
    const { content } = parseFrontmatter(raw);
    // The basename alias [[target]] already resolves to topics/target — no dup.
    expect(content).not.toContain("topics/target");
  });

  it("updates the modified date on the source card", async () => {
    await card("from", "Some content.");
    await card("to", "Target content.");

    await linkCommand(store, "from", "to", "See also");

    const raw = await readFile(join(tmpDir, "cards", "from.md"), "utf-8");
    const { data } = parseFrontmatter(raw);
    const today = new Date().toISOString().split("T")[0];
    const modified = data.modified instanceof Date
      ? data.modified.toISOString().split("T")[0]
      : String(data.modified);
    expect(modified).toBe(today);
  });

  it("errors when the source card does not exist", async () => {
    await card("to", "Target content.");
    const result = await linkCommand(store, "missing", "to", "See also");
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("errors when the target card does not exist", async () => {
    await card("from", "Some content.");
    const result = await linkCommand(store, "from", "missing", "See also");
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("rejects linking a card to itself", async () => {
    await card("solo", "Some content.");
    const result = await linkCommand(store, "solo", "solo", "See also");
    expect(result.success).toBe(false);
    expect(result.error).toContain("itself");
  });
});
