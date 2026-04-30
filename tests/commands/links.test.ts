import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linksCommand } from "../../src/commands/links.js";
import { CardStore } from "../../src/lib/store.js";

describe("linksCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    await writeFile(join(cardsDir, "a.md"), "---\ntitle: A\n---\nSee [[b]] and [[c]].");
    await writeFile(join(cardsDir, "b.md"), "---\ntitle: B\n---\nBack to [[a]].");
    await writeFile(join(cardsDir, "c.md"), "---\ntitle: C\n---\nStandalone content.");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows global link stats when no slug", async () => {
    const result = await linksCommand(store, undefined);
    expect(result.output).toContain("a");
    expect(result.output).toContain("b");
    expect(result.output).toContain("c");
  });

  it("shows outbound and inbound for specific card", async () => {
    const result = await linksCommand(store, "a");
    expect(result.output).toContain("## a");
    expect(result.output).toContain("Outbound:");
    expect(result.output).toContain("[[b]]");
    expect(result.output).toContain("[[c]]");
    expect(result.output).toContain("Inbound:");
    expect(result.output).toContain("[[b]]");
  });

  it("detects orphan (0 inbound)", async () => {
    await writeFile(join(tmpDir, "cards", "orphan.md"), "---\ntitle: Orphan\n---\nNo one links here.");
    const result = await linksCommand(store, undefined);
    expect(result.output).toContain("orphan");
  });

  it("filters to orphans only", async () => {
    await writeFile(join(tmpDir, "cards", "orphan.md"), "---\ntitle: Orphan\n---\nNo one links here.");
    const result = await linksCommand(store, undefined, { filter: "orphan" });
    // a has 1 inbound (from b), b has 1 inbound (from a), c has 1 inbound (from a)
    // orphan has 0 inbound → should appear
    expect(result.output).toContain("orphan");
    // a, b, c all have inbound links → should NOT appear
    expect(result.output).not.toMatch(/^a\s/m);
    expect(result.output).not.toMatch(/^b\s/m);
    expect(result.output).not.toMatch(/^c\s/m);
  });

  it("shows summary stats", async () => {
    const result = await linksCommand(store, undefined, { stats: true });
    expect(result.output).toContain("Total cards: 3");
    expect(result.output).toContain("Orphans (0 inbound):");
    expect(result.output).toContain("Hubs (10+ inbound):");
    expect(result.output).toContain("Avg outbound links:");
    expect(result.output).toContain("Avg inbound links:");
  });

  it("combines filter and stats", async () => {
    await writeFile(join(tmpDir, "cards", "orphan.md"), "---\ntitle: Orphan\n---\nNo one links here.");
    const result = await linksCommand(store, undefined, { filter: "orphan", stats: true });
    expect(result.output).toContain("Showing: orphan");
    expect(result.output).toContain("Total cards: 4");
  });

  it("outputs JSON array for global links", async () => {
    const result = await linksCommand(store, undefined, { json: true });
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(3);
    const a = data.find((d: any) => d.slug === "a");
    expect(a).toBeDefined();
    expect(a.outbound).toBe(2);
    expect(a.inbound).toBe(1);
  });

  it("outputs JSON for specific card", async () => {
    const result = await linksCommand(store, "a", { json: true });
    const data = JSON.parse(result.output);
    expect(data.slug).toBe("a");
    expect(data.outbound).toEqual(["b", "c"]);
    expect(data.inbound).toEqual(["b"]);
  });

  it("outputs JSON stats summary", async () => {
    const result = await linksCommand(store, undefined, { json: true, stats: true });
    const data = JSON.parse(result.output);
    expect(data.totalCards).toBe(3);
    expect(data.showing).toBe("all");
    expect(data.count).toBe(3);
    expect(data.orphans).toBe(0);
    expect(data.hubs).toBe(0);
    expect(typeof data.avgOutbound).toBe("number");
    expect(typeof data.avgInbound).toBe("number");
  });

  it("outputs JSON with filter", async () => {
    await writeFile(join(tmpDir, "cards", "orphan.md"), "---\ntitle: Orphan\n---\nNo one links here.");
    const result = await linksCommand(store, undefined, { json: true, filter: "orphan" });
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((d: any) => d.inbound === 0)).toBe(true);
    expect(data.some((d: any) => d.slug === "orphan")).toBe(true);
  });

  it("outputs JSON stats with filter", async () => {
    await writeFile(join(tmpDir, "cards", "orphan.md"), "---\ntitle: Orphan\n---\nNo one links here.");
    const result = await linksCommand(store, undefined, { json: true, stats: true, filter: "orphan" });
    const data = JSON.parse(result.output);
    expect(data.showing).toBe("orphan");
    expect(data.count).toBe(1);
    expect(data.totalCards).toBe(4);
  });
});
