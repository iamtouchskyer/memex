import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";
import { organizeCommand } from "../../src/commands/organize.js";

describe("organize command", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-organize-test-"));
    const cardsDir = join(tmpDir, "cards");
    const archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty message for no cards", async () => {
    const result = await organizeCommand(store, null);
    expect(result.output).toBe("No cards yet.");
  });

  it("detects orphans", async () => {
    await writeFile(
      join(tmpDir, "cards", "lonely.md"),
      "---\ntitle: Lonely Card\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nNo links here.",
    );
    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Orphans");
    expect(result.output).toContain("lonely");
  });

  it("detects conflict status cards", async () => {
    await writeFile(
      join(tmpDir, "cards", "disputed.md"),
      "---\ntitle: Disputed\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\nstatus: conflict\n---\nConflicting info.",
    );
    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Unresolved Conflicts");
    expect(result.output).toContain("disputed");
  });

  it("pairs recently modified cards with neighbors", async () => {
    await writeFile(
      join(tmpDir, "cards", "card-a.md"),
      "---\ntitle: Card A\ncreated: 2026-03-20\nmodified: 2026-03-25\nsource: test\n---\nSee [[card-b]] for details.",
    );
    await writeFile(
      join(tmpDir, "cards", "card-b.md"),
      "---\ntitle: Card B\ncreated: 2026-03-20\nmodified: 2026-03-20\nsource: test\n---\nSome other info.",
    );
    const result = await organizeCommand(store, "2026-03-24");
    expect(result.output).toContain("card-a ↔ card-b");
  });

  it("includes cards with no modified date when since is provided", async () => {
    await writeFile(
      join(tmpDir, "cards", "no-date.md"),
      "---\ntitle: No Date\ncreated: 2026-01-01\nsource: test\n---\nNo modified field. See [[other]].",
    );
    await writeFile(
      join(tmpDir, "cards", "other.md"),
      "---\ntitle: Other\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nSome info.",
    );
    const result = await organizeCommand(store, "2026-03-24");
    // Cards with no modified date should be included conservatively
    expect(result.output).toContain("no-date ↔ other");
  });

  it("detects hubs with >= 10 inbound links", async () => {
    // Create a hub card
    await writeFile(
      join(tmpDir, "cards", "hub.md"),
      "---\ntitle: Hub Card\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nCentral concept.",
    );
    // Create 10 cards linking to the hub
    for (let i = 0; i < 10; i++) {
      await writeFile(
        join(tmpDir, "cards", `linker-${i}.md`),
        `---\ntitle: Linker ${i}\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nSee [[hub]] for details.`,
      );
    }
    const result = await organizeCommand(store, null);
    expect(result.output).toContain("Hubs");
    expect(result.output).toContain("hub (10 inbound)");
  });

  it("skips old cards when since is provided", async () => {
    await writeFile(
      join(tmpDir, "cards", "old.md"),
      "---\ntitle: Old\ncreated: 2026-01-01\nmodified: 2026-01-01\nsource: test\n---\nOld stuff. See [[new]].",
    );
    await writeFile(
      join(tmpDir, "cards", "new.md"),
      "---\ntitle: New\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nNew stuff.",
    );
    const result = await organizeCommand(store, "2026-03-24");
    // Only "new" was modified after since, so pair should appear
    // "old" was not modified after since, so its outbound links shouldn't generate pairs
    expect(result.output).not.toContain("old ↔ new");
  });

  it("returns valid JSON with expected keys when json=true", async () => {
    await writeFile(
      join(tmpDir, "cards", "alpha.md"),
      "---\ntitle: Alpha\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\nstatus: conflict\n---\nSee [[beta]].",
    );
    await writeFile(
      join(tmpDir, "cards", "beta.md"),
      "---\ntitle: Beta\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nLinked from alpha.",
    );
    const result = await organizeCommand(store, null, true);
    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveProperty("stats");
    expect(parsed).toHaveProperty("orphans");
    expect(parsed).toHaveProperty("hubs");
    expect(parsed).toHaveProperty("conflicts");
    expect(parsed).toHaveProperty("recentPairs");
    expect(parsed.stats).toBeInstanceOf(Array);
    expect(parsed.conflicts.length).toBe(1);
    expect(parsed.conflicts[0].slug).toBe("alpha");
    expect(parsed.recentPairs.length).toBeGreaterThan(0);
    expect(parsed.recentPairs[0]).toHaveProperty("slug1");
    expect(parsed.recentPairs[0]).toHaveProperty("slug2");
    expect(parsed.recentPairs[0]).toHaveProperty("title1");
    expect(parsed.recentPairs[0]).toHaveProperty("title2");
  });

  it("json output does not include content excerpts", async () => {
    await writeFile(
      join(tmpDir, "cards", "verbose.md"),
      "---\ntitle: Verbose\ncreated: 2026-03-25\nmodified: 2026-03-25\nsource: test\n---\nThis is some long content that should not appear in JSON output.",
    );
    const result = await organizeCommand(store, null, true);
    const parsed = JSON.parse(result.output);
    const jsonStr = JSON.stringify(parsed);
    expect(jsonStr).not.toContain("long content that should not appear");
  });
});
