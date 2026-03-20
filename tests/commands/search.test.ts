import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import { CardStore } from "../../src/lib/store.js";

describe("searchCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    await writeFile(
      join(cardsDir, "jwt-migration.md"),
      `---
title: JWT Migration
created: 2026-03-18
modified: 2026-03-18
source: retro
---

JWT migration is about moving from sessions to tokens.

See [[stateless-auth]] for the theory behind this.`
    );

    await writeFile(
      join(cardsDir, "caching.md"),
      `---
title: Caching Strategy
created: 2026-03-18
modified: 2026-03-18
source: retro
---

Redis vs Memcached overview.

When JWT revoke fails, use cache as fallback. See [[jwt-migration]].`
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists all cards when no query", async () => {
    const result = await searchCommand(store, undefined);
    expect(result.output).toContain("jwt-migration");
    expect(result.output).toContain("JWT Migration");
    expect(result.output).toContain("caching");
    expect(result.output).toContain("Caching Strategy");
  });

  it("searches cards matching query", async () => {
    const result = await searchCommand(store, "JWT");
    expect(result.output).toContain("## jwt-migration");
    expect(result.output).toContain("JWT Migration");
    expect(result.output).toContain("[[stateless-auth]]");
  });

  it("returns empty for no matches", async () => {
    const result = await searchCommand(store, "nonexistent-term-xyz");
    expect(result.output).toBe("");
  });
});
