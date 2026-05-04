import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import type { ManifestFilter } from "../../src/commands/search.js";
import { CardStore } from "../../src/lib/store.js";

describe("manifest pre-filter", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-filter-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    // Card 1: frontend category, tags as array, author alice
    await writeFile(
      join(cardsDir, "react-hooks.md"),
      `---
title: React Hooks Guide
created: 2026-01-15
modified: 2026-02-10
category: frontend
tags:
  - react
  - hooks
  - javascript
author: alice
source: manual
---

A comprehensive guide to React hooks including useState and useEffect.`
    );

    // Card 2: backend category, tags as comma-separated string, author bob
    await writeFile(
      join(cardsDir, "api-auth.md"),
      `---
title: API Authentication
created: 2026-02-20
modified: 2026-03-05
category: backend
tags: 'auth, security, jwt'
author: bob
source: retro
---

How to implement JWT-based API authentication.`
    );

    // Card 3: frontend category, source (no author), recent dates
    await writeFile(
      join(cardsDir, "css-grid.md"),
      `---
title: CSS Grid Layout
created: 2026-03-01
modified: 2026-03-20
category: frontend
tags:
  - css
  - layout
source: alice
---

CSS Grid is a powerful layout system for building responsive designs.`
    );

    // Card 4: no category, no tags, old dates
    await writeFile(
      join(cardsDir, "old-notes.md"),
      `---
title: Old Notes
created: 2025-06-01
modified: 2025-07-15
---

Some old notes without category or tags.`
    );

    // Card 5: devops category, tags as array, author charlie
    await writeFile(
      join(cardsDir, "docker-setup.md"),
      `---
title: Docker Setup
created: 2026-03-10
modified: 2026-03-15
category: devops
tags:
  - docker
  - containers
author: charlie
---

Guide to setting up Docker for local development.`
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Individual filter tests ---

  it("filters by category", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "frontend" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
    expect(result.output).not.toContain("docker-setup");
    expect(result.output).not.toContain("old-notes");
  });

  it("filters by category case-insensitively", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "Frontend" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
  });

  it("filters by tag (array format)", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { tag: "react" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).not.toContain("api-auth");
    expect(result.output).not.toContain("css-grid");
  });

  it("filters by tag (comma-separated string format)", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { tag: "jwt" },
    });
    expect(result.output).toContain("api-auth");
    expect(result.output).not.toContain("react-hooks");
  });

  it("filters by tag case-insensitively", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { tag: "React" },
    });
    expect(result.output).toContain("react-hooks");
  });

  it("filters by author (author field)", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { author: "alice" },
    });
    // alice is author on react-hooks, source on css-grid
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
  });

  it("filters by author matching source field", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { author: "retro" },
    });
    expect(result.output).toContain("api-auth");
    expect(result.output).not.toContain("react-hooks");
  });

  it("filters by author case-insensitively", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { author: "Alice" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
  });

  it("filters by --since date", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { since: "2026-03-01" },
    });
    // css-grid: created=2026-03-01 (>=), docker-setup: created=2026-03-10 (>=)
    // api-auth: modified=2026-03-05 (>=)
    expect(result.output).toContain("css-grid");
    expect(result.output).toContain("docker-setup");
    expect(result.output).toContain("api-auth");
    // react-hooks: created=2026-01-15, modified=2026-02-10 (both <)
    expect(result.output).not.toContain("react-hooks");
    // old-notes: created=2025-06-01, modified=2025-07-15 (both <)
    expect(result.output).not.toContain("old-notes");
  });

  it("filters by --before date", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { before: "2026-02-01" },
    });
    // react-hooks: created=2026-01-15 (< 2026-02-01) ✓
    // old-notes: created=2025-06-01, modified=2025-07-15 (both <) ✓
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("old-notes");
    // api-auth: created=2026-02-20, modified=2026-03-05 (both >=)
    expect(result.output).not.toContain("api-auth");
    // css-grid: created=2026-03-01, modified=2026-03-20 (both >=)
    expect(result.output).not.toContain("css-grid");
  });

  // --- Filter combinations (AND logic) ---

  it("combines category + tag filters (AND)", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "frontend", tag: "react" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).not.toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
  });

  it("combines category + author filters (AND)", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "frontend", author: "alice" },
    });
    // react-hooks: frontend + author=alice ✓
    // css-grid: frontend + source=alice ✓
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
  });

  it("combines since + before for date range", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { since: "2026-02-01", before: "2026-03-01" },
    });
    // react-hooks: modified=2026-02-10 (>= since, < before) ✓
    // api-auth: created=2026-02-20 (>= since, < before) ✓
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("api-auth");
    // css-grid: created=2026-03-01 (not < before for any field where also >= since)
    // old-notes: nothing >= since
    expect(result.output).not.toContain("old-notes");
  });

  it("combines all filters", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "frontend", tag: "react", author: "alice", since: "2026-01-01" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).not.toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
  });

  // --- Filter + keyword search ---

  it("applies filter before keyword search", async () => {
    // "guide" appears in react-hooks and docker-setup
    // filter to frontend only -> only react-hooks
    const result = await searchCommand(store, "guide", {
      filter: { category: "frontend" },
    });
    expect(result.output).toContain("react-hooks");
    expect(result.output).not.toContain("docker-setup");
  });

  // --- Filter + semantic search ---

  it("applies filter before semantic search", async () => {
    const mockProvider = {
      model: "test-model",
      embed: async (texts: string[]) =>
        texts.map(() => [1, 0, 0]),
    };

    const result = await searchCommand(store, "hooks", {
      semantic: true,
      memexHome: tmpDir,
      filter: { category: "frontend" },
      _embeddingProvider: mockProvider,
    });
    // Both frontend cards should appear, but not backend/devops/uncategorized
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("css-grid");
    expect(result.output).not.toContain("api-auth");
    expect(result.output).not.toContain("docker-setup");
    expect(result.output).not.toContain("old-notes");
  });

  // --- Edge cases ---

  it("returns empty when no cards match filter", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "nonexistent" },
    });
    expect(result.output).toBe("");
  });

  it("returns empty when filter + query has no matches", async () => {
    const result = await searchCommand(store, "xyznonexistent", {
      filter: { category: "frontend" },
    });
    expect(result.output).toBe("");
  });

  it("does not match filter values in body content", async () => {
    // "responsive" appears in css-grid body but not in any frontmatter field we filter on
    // Filtering by tag "responsive" should NOT match css-grid
    const result = await searchCommand(store, undefined, {
      filter: { tag: "responsive" },
    });
    expect(result.output).not.toContain("css-grid");
    expect(result.output).toBe("");
  });

  it("cards without tags field are excluded by tag filter", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { tag: "anything" },
    });
    expect(result.output).not.toContain("old-notes");
  });

  it("cards without category field are excluded by category filter", async () => {
    const result = await searchCommand(store, undefined, {
      filter: { category: "frontend" },
    });
    expect(result.output).not.toContain("old-notes");
  });

  it("no filter applied when filter object is undefined", async () => {
    const result = await searchCommand(store, undefined);
    // All cards should be listed
    expect(result.output).toContain("react-hooks");
    expect(result.output).toContain("api-auth");
    expect(result.output).toContain("css-grid");
    expect(result.output).toContain("old-notes");
    expect(result.output).toContain("docker-setup");
  });
});
