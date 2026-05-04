import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateCommand } from "../../src/commands/migrate.js";

describe("migrateCommand", () => {
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

  it("enables nestedSlugs when no collisions exist", async () => {
    await writeFile(join(cardsDir, "foo.md"), "foo");
    await writeFile(join(cardsDir, "bar.md"), "bar");

    const result = await migrateCommand(tmpDir, cardsDir, archiveDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Enabled nestedSlugs");
    expect(result.output).toContain("No slug collisions found");

    const configPath = join(tmpDir, ".memexrc");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    expect(config.nestedSlugs).toBe(true);
  });

  it("creates .memexrc if it doesn't exist", async () => {
    await writeFile(join(cardsDir, "test.md"), "test");

    const result = await migrateCommand(tmpDir, cardsDir, archiveDir);
    expect(result.success).toBe(true);

    const configPath = join(tmpDir, ".memexrc");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    expect(config).toEqual({ nestedSlugs: true });
  });

  it("preserves existing config settings", async () => {
    await writeFile(join(cardsDir, "test.md"), "test");
    const configPath = join(tmpDir, ".memexrc");
    await writeFile(configPath, JSON.stringify({ customSetting: "value" }));

    const result = await migrateCommand(tmpDir, cardsDir, archiveDir);
    expect(result.success).toBe(true);

    const config = JSON.parse(await readFile(configPath, "utf-8"));
    expect(config.nestedSlugs).toBe(true);
    expect(config.customSetting).toBe("value");
  });

  it("aborts when collisions exist", async () => {
    await mkdir(join(cardsDir, "sub"), { recursive: true });
    await writeFile(join(cardsDir, "collision.md"), "root");
    await writeFile(join(cardsDir, "sub", "collision.md"), "sub");

    const result = await migrateCommand(tmpDir, cardsDir, archiveDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Slug "collision" collides');
    expect(result.error).toContain("Resolve collisions before enabling nestedSlugs");
  });

  it("does not create .memexrc when collisions exist", async () => {
    await mkdir(join(cardsDir, "sub"), { recursive: true });
    await writeFile(join(cardsDir, "collision.md"), "root");
    await writeFile(join(cardsDir, "sub", "collision.md"), "sub");

    await migrateCommand(tmpDir, cardsDir, archiveDir);

    try {
      await readFile(join(tmpDir, ".memexrc"), "utf-8");
      expect.fail("Should not create .memexrc when collisions exist");
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });
});
