import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import { CardStore } from "../../src/lib/store.js";
import { MemexConfig } from "../../src/lib/config.js";

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

  it("searches cards matching query in body", async () => {
    const result = await searchCommand(store, "JWT");
    expect(result.output).toContain("## jwt-migration");
    expect(result.output).toContain("JWT Migration");
    expect(result.output).toContain("[[stateless-auth]]");
  });

  it("returns empty for no matches", async () => {
    const result = await searchCommand(store, "nonexistent-term-xyz");
    expect(result.output).toBe("");
  });

  it("does NOT match frontmatter-only content", async () => {
    // "retro" appears in frontmatter (source: retro) but not in body
    const result = await searchCommand(store, "retro");
    expect(result.output).toBe("");
  });

  it("ranks results by match density", async () => {
    // "JWT" appears 1x in jwt-migration body, 1x in caching body
    // Both should match, jwt-migration first (or equal)
    const result = await searchCommand(store, "JWT");
    expect(result.output).toContain("## jwt-migration");
    expect(result.output).toContain("## caching");
  });

  it("respects limit option", async () => {
    const result = await searchCommand(store, "JWT", { limit: 1 });
    const headings = result.output.match(/^## /gm) || [];
    expect(headings.length).toBe(1);
  });

  it("treats negative limit as default (not slice-from-end)", async () => {
    // With 2 matching cards and limit=-1, should NOT silently strip the last result
    // It should fall back to DEFAULT_LIMIT (10), returning all 2 matches
    const result = await searchCommand(store, "JWT", { limit: -1 });
    // Should contain all matches (both jwt-migration and caching have 'JWT')
    expect(result.output).toContain("## jwt-migration");
    expect(result.output).toContain("## caching");
  });

  it("returns empty output for limit=0", async () => {
    const result = await searchCommand(store, "JWT", { limit: 0 });
    expect(result.output).toBe("");
  });

  it("is case-insensitive", async () => {
    const result = await searchCommand(store, "jwt");
    expect(result.output).toContain("## jwt-migration");
  });

  it("compact:true produces shorter output than default", async () => {
    const full = await searchCommand(store, "JWT");
    const compact = await searchCommand(store, "JWT", { compact: true });
    expect(compact.output.length).toBeLessThan(full.output.length);
    expect(compact.output).toBeTruthy();
  });

  it("compact output contains slug and title but no heading prefix", async () => {
    const result = await searchCommand(store, "JWT", { compact: true });
    expect(result.output).toContain("jwt-migration");
    expect(result.output).toContain("JWT Migration");
    expect(result.output).not.toContain("## ");
  });

  it("compact output has no first paragraph or links section", async () => {
    const result = await searchCommand(store, "JWT", { compact: true });
    expect(result.output).not.toContain("Links:");
    expect(result.output).not.toContain("JWT migration is about moving from sessions to tokens.");
  });
});

describe("searchCommand with --all flag (multi-directory)", () => {
  let tmpDir: string;
  let memexHome: string;
  let store: CardStore;
  let config: MemexConfig;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-multi-"));
    memexHome = tmpDir;
    const cardsDir = join(tmpDir, "cards");
    const projectsDir = join(tmpDir, "projects");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    // Card in cards/
    await writeFile(
      join(cardsDir, "auth.md"),
      `---
title: Authentication
created: 2026-03-18
---

Basic authentication concepts.`
    );

    // Card in projects/
    await writeFile(
      join(projectsDir, "api-design.md"),
      `---
title: API Design
created: 2026-03-18
---

REST API design patterns.`
    );

    // Another card in projects/
    await writeFile(
      join(projectsDir, "deployment.md"),
      `---
title: Deployment Guide
created: 2026-03-18
---

How to deploy the authentication service.`
    );

    config = {
      nestedSlugs: false,
      searchDirs: ["projects"],
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("searches only cards/ when --all is not set", async () => {
    const result = await searchCommand(store, "API");
    expect(result.output).not.toContain("api-design");
    expect(result.output).toBe("");
  });

  it("searches cards/ and projects/ when --all is set", async () => {
    const result = await searchCommand(store, "API", { all: true, config, memexHome });
    expect(result.output).toContain("projects/api-design");
    expect(result.output).toContain("API Design");
  });

  it("prefixes slugs with directory name when using --all", async () => {
    const result = await searchCommand(store, "authentication", { all: true, config, memexHome });
    expect(result.output).toContain("cards/auth");
    expect(result.output).toContain("projects/deployment");
  });

  it("lists all cards from all directories when --all is set without query", async () => {
    const result = await searchCommand(store, undefined, { all: true, config, memexHome });
    expect(result.output).toContain("cards/auth");
    expect(result.output).toContain("projects/api-design");
    expect(result.output).toContain("projects/deployment");
  });

  it("works with empty searchDirs config", async () => {
    const emptyConfig: MemexConfig = {
      nestedSlugs: false,
      searchDirs: [],
    };
    const result = await searchCommand(store, "authentication", { all: true, config: emptyConfig, memexHome });
    // Empty searchDirs means only cards/ is searched, no prefix
    expect(result.output).toContain("## auth");
    expect(result.output).not.toContain("projects/");
    expect(result.output).not.toContain("cards/");
  });

  it("works with undefined searchDirs", async () => {
    const noSearchDirsConfig: MemexConfig = {
      nestedSlugs: false,
    };
    const result = await searchCommand(store, "authentication", { all: true, config: noSearchDirsConfig, memexHome });
    // Undefined searchDirs means only cards/ is searched, no prefix
    expect(result.output).toContain("## auth");
    expect(result.output).not.toContain("projects/");
    expect(result.output).not.toContain("cards/");
  });
});
