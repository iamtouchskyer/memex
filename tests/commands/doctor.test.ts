import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand } from "../../src/commands/doctor.js";

describe("doctorCommand", () => {
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
