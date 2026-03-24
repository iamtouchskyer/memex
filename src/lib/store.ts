import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, basename, dirname, resolve, sep } from "node:path";

// Characters not allowed in slugs (OS-reserved or dangerous)
const RESERVED_CHARS = /[:*?"<>|]/;

/**
 * Validate a slug before writing. Throws on invalid slugs.
 *
 * Rules:
 *  - Must not be empty or whitespace-only after trimming
 *  - Must not consist solely of dots and/or slashes
 *  - Must not contain OS-reserved characters (: * ? " < > |)
 *  - Must not contain empty path segments (e.g. "a//b", "/foo", "foo/")
 */
export function validateSlug(slug: string): void {
  const trimmed = slug.trim();

  if (trimmed.length === 0) {
    throw new Error("Invalid slug: must not be empty or whitespace-only");
  }

  // Reject slugs that are only dots and/or slashes (e.g. "..", "./.", "///")
  if (/^[./\\]+$/.test(trimmed)) {
    throw new Error("Invalid slug: must not consist only of dots and slashes");
  }

  if (RESERVED_CHARS.test(trimmed)) {
    throw new Error("Invalid slug: contains reserved characters (: * ? \" < > |)");
  }

  // Reject leading/trailing slashes or consecutive slashes (empty path segments)
  // Check both Unix (/) and Windows (\) separators
  if (
    trimmed.startsWith("/") || trimmed.startsWith("\\") ||
    trimmed.endsWith("/") || trimmed.endsWith("\\") ||
    trimmed.includes("//") || trimmed.includes("\\\\")
  ) {
    throw new Error("Invalid slug: must not contain empty path segments");
  }

  // Reject path segments that are just dots (e.g. "a/../b", "./foo")
  const segments = trimmed.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error("Invalid slug: path segments must not be '.' or '..'");
    }
  }
}

interface ScannedCard {
  slug: string;
  path: string;
}

export class CardStore {
  private scanCache: ScannedCard[] | null = null;

  constructor(
    public readonly cardsDir: string,
    private archiveDir: string
  ) {}

  /** Invalidate scan cache after writes/deletes */
  invalidateCache(): void {
    this.scanCache = null;
  }

  async scanAll(): Promise<ScannedCard[]> {
    if (this.scanCache) return this.scanCache;
    const results: ScannedCard[] = [];
    await this.walkDir(this.cardsDir, results);
    this.scanCache = results;
    return results;
  }

  private async walkDir(dir: string, results: ScannedCard[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, results);
      } else if (entry.name.endsWith(".md")) {
        results.push({
          slug: basename(entry.name, ".md"),
          path: fullPath,
        });
      }
    }
  }

  async resolve(slug: string): Promise<string | null> {
    const cards = await this.scanAll();
    const found = cards.find((c) => c.slug === slug);
    return found?.path ?? null;
  }

  async readCard(slug: string): Promise<string> {
    const path = await this.resolve(slug);
    if (!path) throw new Error(`Card not found: ${slug}`);
    return readFile(path, "utf-8");
  }

  private assertSafePath(targetPath: string): void {
    const resolved = resolve(targetPath);
    const cardsResolved = resolve(this.cardsDir);
    if (!resolved.startsWith(cardsResolved + sep) && resolved !== cardsResolved) {
      throw new Error(`Invalid slug: path escapes cards directory`);
    }
  }

  async writeCard(slug: string, content: string): Promise<void> {
    validateSlug(slug);
    const existing = await this.resolve(slug);
    const targetPath = existing ?? join(this.cardsDir, `${slug}.md`);
    this.assertSafePath(targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf-8");
    this.invalidateCache();
  }

  async archiveCard(slug: string): Promise<void> {
    const path = await this.resolve(slug);
    if (!path) {
      try {
        await readFile(join(this.archiveDir, `${slug}.md`));
        throw new Error(`Card already archived: ${slug}`);
      } catch (e) {
        if ((e as Error).message.includes("already archived")) throw e;
        throw new Error(`Card not found: ${slug}`);
      }
    }
    await mkdir(this.archiveDir, { recursive: true });
    const dest = join(this.archiveDir, `${slug}.md`);
    await rename(path, dest);
    this.invalidateCache();
  }
}
