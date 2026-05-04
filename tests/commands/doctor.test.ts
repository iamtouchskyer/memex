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
  scanExtraSlugs,
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

  it("outputs JSON when --json flag is passed (no collisions)", async () => {
    await writeFile(join(cardsDir, "foo.md"), "foo content");

    const result = await doctorCommand(cardsDir, archiveDir, true);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output!);
    expect(parsed).toEqual([{ name: "Slug collisions", status: "ok" }]);
  });

  it("outputs JSON when --json flag is passed (with collisions)", async () => {
    await mkdir(join(cardsDir, "sub"), { recursive: true });
    await writeFile(join(cardsDir, "foo.md"), "foo root");
    await writeFile(join(cardsDir, "sub", "foo.md"), "foo sub");

    const result = await doctorCommand(cardsDir, archiveDir, true);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Slug collisions");
    expect(parsed[0].status).toBe("error");
    expect(parsed[0].details).toBeDefined();
    expect(parsed[0].details[0].slug).toBe("foo");
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

describe("doctor nested slug link resolution", () => {
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

  it("resolves basename links to nested slugs (no false broken links)", async () => {
    await mkdir(join(cardsDir, "projects"), { recursive: true });
    await writeFile(join(cardsDir, "projects", "myproj.md"), "project content");
    await writeFile(join(cardsDir, "index.md"), "see [[myproj]] for details");

    const result = await checkBrokenLinks(cardsDir, archiveDir);
    expect(result.status).toBe("ok");
  });

  it("still reports truly broken links with nested slugs", async () => {
    await mkdir(join(cardsDir, "projects"), { recursive: true });
    await writeFile(join(cardsDir, "projects", "real.md"), "content");
    await writeFile(join(cardsDir, "index.md"), "see [[real]] and [[ghost]]");

    const result = await checkBrokenLinks(cardsDir, archiveDir);
    expect(result.status).toBe("warn");
    expect(result.details).toHaveLength(1);
    expect(result.details![0]).toContain("ghost");
  });

  it("counts inbound links correctly via basename resolution for orphan check", async () => {
    await mkdir(join(cardsDir, "projects"), { recursive: true });
    await writeFile(join(cardsDir, "projects", "target.md"), "project");
    await writeFile(join(cardsDir, "hub.md"), "link to [[target]]");

    const result = await checkOrphans(cardsDir, archiveDir);
    const orphanSlugs = result.details || [];
    expect(orphanSlugs).toContain("hub");
    expect(orphanSlugs).not.toContain("projects/target");
  });
});

describe("extraLinkDirs support", () => {
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

  it("scanExtraSlugs collects .md basenames from extra dirs", async () => {
    const extDir = join(tmpDir, "refs");
    await mkdir(join(extDir, "sub"), { recursive: true });
    await writeFile(join(extDir, "alpha.md"), "content");
    await writeFile(join(extDir, "sub", "beta.md"), "content");
    await writeFile(join(extDir, "readme.txt"), "not md");

    const slugs = await scanExtraSlugs(tmpDir, ["refs"]);
    expect(slugs.has("alpha")).toBe(true);
    expect(slugs.has("beta")).toBe(true);
    expect(slugs.has("readme")).toBe(false);
  });

  it("checkBrokenLinks with extraSlugs: link in extraSlugs is not broken", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[external-note]]");

    const extraSlugs = new Set(["external-note"]);
    const result = await checkBrokenLinks(cardsDir, archiveDir, false, extraSlugs);
    expect(result.status).toBe("ok");
  });

  it("checkBrokenLinks with extraSlugs: link NOT in extraSlugs is still broken", async () => {
    await writeFile(join(cardsDir, "a.md"), "links to [[missing]]");

    const extraSlugs = new Set(["other-note"]);
    const result = await checkBrokenLinks(cardsDir, archiveDir, false, extraSlugs);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("1 link(s)");
  });

  it("doctorRunAll with extraLinkDirs reduces false broken links", async () => {
    const extDir = join(tmpDir, "refs");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "external.md"), "content");
    await writeFile(join(cardsDir, "a.md"), "links to [[external]]");

    const withoutExtra = await doctorRunAll(cardsDir, archiveDir);
    expect(withoutExtra.output).toContain("⚠ Broken links");

    const withExtra = await doctorRunAll(cardsDir, archiveDir, false, false, tmpDir, ["refs"]);
    expect(withExtra.output).toContain("✓ Broken links");
  });
});
