import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  doctorCommand,
  doctorRunAll,
  checkCollisions,
  checkOrphans,
  checkBrokenLinks,
} from "../../src/commands/doctor.js";

describe("doctorCommand (legacy collision check)", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports no collisions when all slugs are unique", async () => {
    await writeFile(join(cardsDir, "foo.md"), "foo content");
    await writeFile(join(cardsDir, "bar.md"), "bar content");

    const result = await doctorCommand(cardsDir, archiveDir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("No slug collisions found");
    expect(result.output).toContain("Safe to enable nestedSlugs");
  });

  it("detects collision when basename slugs match", async () => {
    await mkdir(join(cardsDir, "sub"), { recursive: true });
    await writeFile(join(cardsDir, "foo.md"), "foo root");
    await writeFile(join(cardsDir, "sub", "foo.md"), "foo sub");

    const result = await doctorCommand(cardsDir, archiveDir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Found 1 slug collision');
    expect(result.output).toContain('Slug "foo" collides');
    expect(result.output).toContain("Resolve these collisions");
  });

  it("detects multiple collision groups", async () => {
    await mkdir(join(cardsDir, "a"), { recursive: true });
    await mkdir(join(cardsDir, "b"), { recursive: true });
    await writeFile(join(cardsDir, "test.md"), "test root");
    await writeFile(join(cardsDir, "a", "test.md"), "test a");
    await writeFile(join(cardsDir, "demo.md"), "demo root");
    await writeFile(join(cardsDir, "b", "demo.md"), "demo b");

    const result = await doctorCommand(cardsDir, archiveDir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Found 2 slug collision");
    expect(result.output).toContain('Slug "test" collides');
    expect(result.output).toContain('Slug "demo" collides');
  });

  it("shows full paths in collision report", async () => {
    await mkdir(join(cardsDir, "nested", "deep"), { recursive: true });
    await writeFile(join(cardsDir, "card.md"), "card root");
    await writeFile(join(cardsDir, "nested", "deep", "card.md"), "card nested");

    const result = await doctorCommand(cardsDir, archiveDir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("would become: card");
    expect(result.output).toContain("would become: nested/deep/card");
  });
});

describe("checkOrphans", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports ok when all cards have inbound links", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await checkOrphans(cardsDir, archiveDir);
    expect(result.status).toBe("ok");
  });

  it("detects orphan cards with no inbound links", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "no links");
    await writeFile(join(cardsDir, "c.md"), "also no links");

    const result = await checkOrphans(cardsDir, archiveDir);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("2 cards");
    expect(result.message).toContain("no inbound links");
  });

  it("lists orphan slugs in verbose mode", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "no links");
    await writeFile(join(cardsDir, "c.md"), "also no links");

    const result = await checkOrphans(cardsDir, archiveDir, true);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("  a");
    expect(result.message).toContain("  c");
  });

  it("reports ok for empty wiki", async () => {
    const result = await checkOrphans(cardsDir, archiveDir);
    expect(result.status).toBe("ok");
  });
});

describe("checkBrokenLinks", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports ok when all links resolve", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "exists");

    const result = await checkBrokenLinks(cardsDir, archiveDir);
    expect(result.status).toBe("ok");
  });

  it("detects links to non-existent cards", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[missing]] and [[also-missing]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await checkBrokenLinks(cardsDir, archiveDir);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("2 link(s) to non-existent cards");
  });

  it("shows details in verbose mode", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[missing]] and [[also-missing]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await checkBrokenLinks(cardsDir, archiveDir, true);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("a \u2192 missing");
    expect(result.message).toContain("a \u2192 also-missing");
  });

  it("omits details without verbose", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[missing]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await checkBrokenLinks(cardsDir, archiveDir, false);
    expect(result.message).not.toContain("\u2192");
  });
});

describe("doctorRunAll", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns exit 0 for a healthy wiki", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await doctorRunAll(cardsDir, archiveDir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("✓ Slug collisions");
    expect(result.output).toContain("✓ Orphans");
    expect(result.output).toContain("✓ Broken links");
  });

  it("returns exit 0 even with warnings", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "no links");
    await writeFile(join(cardsDir, "c.md"), "also no links, links to [[missing]]");

    const result = await doctorRunAll(cardsDir, archiveDir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("⚠ Orphans");
    expect(result.output).toContain("⚠ Broken links");
  });

  it("returns exit 1 when collisions exist", async () => {
    await mkdir(join(cardsDir, "sub"), { recursive: true });
    await writeFile(join(cardsDir, "x.md"), "root");
    await writeFile(join(cardsDir, "sub", "x.md"), "sub");

    const result = await doctorRunAll(cardsDir, archiveDir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("✗ Slug collisions");
  });

  it("outputs valid JSON with --json flag", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "no links");
    await writeFile(join(cardsDir, "c.md"), "links to [[missing]]");

    const result = await doctorRunAll(cardsDir, archiveDir, false, true);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output!);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toHaveProperty("name", "Slug collisions");
    expect(parsed[0]).toHaveProperty("status", "ok");
    expect(parsed[1]).toHaveProperty("name", "Orphans");
    expect(parsed[1]).toHaveProperty("status", "warn");
    expect(parsed[1].details).toContain("a");
    expect(parsed[2]).toHaveProperty("name", "Broken links");
    expect(parsed[2]).toHaveProperty("status", "warn");
    expect(parsed[2].details).toContain("c → missing");
  });

  it("omits details in JSON when check is ok", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[b]]");
    await writeFile(join(cardsDir, "b.md"), "links to [[a]]");

    const result = await doctorRunAll(cardsDir, archiveDir, false, true);
    const parsed = JSON.parse(result.output!);
    expect(parsed[0]).not.toHaveProperty("details");
    expect(parsed[1]).not.toHaveProperty("details");
    expect(parsed[2]).not.toHaveProperty("details");
  });
});
