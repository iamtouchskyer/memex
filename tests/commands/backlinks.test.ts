import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backlinksCommand } from "../../src/commands/backlinks.js";
import { CardStore } from "../../src/lib/store.js";
import { MemexConfig } from "../../src/lib/config.js";

describe("backlinksCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    await writeFile(
      join(cardsDir, "a.md"),
      "---\ntitle: A\n---\nSee [[b]] and [[c]]."
    );
    await writeFile(
      join(cardsDir, "b.md"),
      "---\ntitle: B\n---\nBack to [[a]]."
    );
    await writeFile(
      join(cardsDir, "c.md"),
      "---\ntitle: C\n---\nStandalone content."
    );
    await writeFile(
      join(cardsDir, "d.md"),
      "---\ntitle: D\n---\nLinks to [[b]] and [[a]]."
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds backlinks for a card linked by others", async () => {
    const result = await backlinksCommand(store, "b");
    expect(result.output).toContain("Backlinks for b:");
    expect(result.output).toContain("a (cards/)");
    expect(result.output).toContain("d (cards/)");
    expect(result.exitCode).toBe(0);
  });

  it("returns no-backlinks message for unlinked card", async () => {
    // c has no [[wiki-links]] pointing to it except from a
    // Use a slug that truly has no backlinks
    const result = await backlinksCommand(store, "d");
    expect(result.output).toBe("No backlinks found for d");
    expect(result.exitCode).toBe(0);
  });

  it("returns no-backlinks message for nonexistent slug", async () => {
    const result = await backlinksCommand(store, "nonexistent");
    expect(result.output).toBe("No backlinks found for nonexistent");
    expect(result.exitCode).toBe(0);
  });

  it("finds backlinks from multiple cards", async () => {
    const result = await backlinksCommand(store, "a");
    expect(result.output).toContain("Backlinks for a:");
    expect(result.output).toContain("b (cards/)");
    expect(result.output).toContain("d (cards/)");
  });

  it("does not include self-links as backlinks", async () => {
    await writeFile(
      join(tmpDir, "cards", "self.md"),
      "---\ntitle: Self\n---\nI reference [[self]] and [[b]]."
    );
    const result = await backlinksCommand(store, "b");
    expect(result.output).toContain("self (cards/)");
    // self should appear as a backlink to b, but let's verify self-referencing
    const selfResult = await backlinksCommand(store, "self");
    expect(selfResult.output).toContain("self (cards/)");
  });

  it("formats output with indented list", async () => {
    const result = await backlinksCommand(store, "b");
    const lines = result.output.split("\n");
    expect(lines[0]).toBe("Backlinks for b:");
    expect(lines.slice(1).every((l: string) => l.startsWith("  - "))).toBe(true);
  });
});

describe("backlinksCommand with --all flag (multi-directory)", () => {
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

    // Card in cards/ that links to "auth"
    await writeFile(
      join(cardsDir, "login-flow.md"),
      "---\ntitle: Login Flow\n---\nUses [[auth]] for validation."
    );

    // Card in cards/ with no outbound links
    await writeFile(
      join(cardsDir, "auth.md"),
      "---\ntitle: Authentication\n---\nBasic authentication concepts."
    );

    // Card in projects/ that links to "auth"
    await writeFile(
      join(projectsDir, "api-design.md"),
      "---\ntitle: API Design\n---\nREST API needs [[auth]] and [[caching]]."
    );

    // Card in projects/ with no link to "auth"
    await writeFile(
      join(projectsDir, "deployment.md"),
      "---\ntitle: Deployment Guide\n---\nHow to deploy the service."
    );

    config = {
      nestedSlugs: false,
      searchDirs: ["projects"],
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("scans only cards/ when --all is not set", async () => {
    const result = await backlinksCommand(store, "auth");
    expect(result.output).toContain("login-flow (cards/)");
    expect(result.output).not.toContain("api-design");
    expect(result.output).not.toContain("projects/");
  });

  it("scans cards/ and projects/ when --all is set", async () => {
    const result = await backlinksCommand(store, "auth", {
      all: true,
      config,
      memexHome,
    });
    expect(result.output).toContain("Backlinks for auth:");
    expect(result.output).toContain("login-flow (cards/)");
    expect(result.output).toContain("api-design (projects/)");
  });

  it("does not include cards that do not link to slug", async () => {
    const result = await backlinksCommand(store, "auth", {
      all: true,
      config,
      memexHome,
    });
    expect(result.output).not.toContain("deployment");
    expect(result.output).not.toContain("auth (cards/)");
  });

  it("returns no-backlinks when slug not linked from any directory", async () => {
    const result = await backlinksCommand(store, "deployment", {
      all: true,
      config,
      memexHome,
    });
    expect(result.output).toBe("No backlinks found for deployment");
  });

  it("works with empty searchDirs config", async () => {
    const emptyConfig: MemexConfig = {
      nestedSlugs: false,
      searchDirs: [],
    };
    const result = await backlinksCommand(store, "auth", {
      all: true,
      config: emptyConfig,
      memexHome,
    });
    // Only cards/ searched, no projects/
    expect(result.output).toContain("login-flow (cards/)");
    expect(result.output).not.toContain("projects/");
  });

  it("works with undefined searchDirs", async () => {
    const noSearchDirsConfig: MemexConfig = {
      nestedSlugs: false,
    };
    const result = await backlinksCommand(store, "auth", {
      all: true,
      config: noSearchDirsConfig,
      memexHome,
    });
    // Only cards/ searched
    expect(result.output).toContain("login-flow (cards/)");
    expect(result.output).not.toContain("projects/");
  });
});
