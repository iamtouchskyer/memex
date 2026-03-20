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
});
