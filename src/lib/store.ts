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
    private archiveDir: string,
    private nestedSlugs: boolean = false
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
        // Use relative path for nested slugs to prevent collision
        const slug = this.nestedSlugs
          ? join(dir, entry.name)
              .replace(this.cardsDir + sep, "")
              .replace(/\.md$/, "")
              .replace(/\\/g, "/")
          : basename(entry.name, ".md");

        results.push({
          slug,
          path: fullPath,
        });
      }
    }
  }

  async resolve(slug: string): Promise<string | null> {
    const cards = await this.scanAll();
    const normalised = slug.replace(/\\/g, "/");
    const found = cards.find((c) => c.slug === normalised);
    return found?.path ?? null;
  }

  /**
   * Resolve a wikilink target to a known slug.
   * 1. Exact match
   * 2. Basename-only fallback (only if unambiguous — exactly one card has that basename)
   * Returns the matched slug or null.
   */
  async resolveLink(link: string): Promise<string | null> {
    const cards = await this.scanAll();
    const normalised = link.replace(/\\/g, "/");

    // Exact match
    if (cards.some((c) => c.slug === normalised)) {
      return normalised;
    }

    // Basename fallback: find cards whose slug ends with /link
    if (!normalised.includes("/")) {
      const matches = cards.filter((c) => {
        const parts = c.slug.split("/");
        return parts[parts.length - 1] === normalised;
      });
      if (matches.length === 1) {
        return matches[0].slug;
      }
    }

    return null;
  }

  /**
   * Build a synchronous link resolution map for batch operations.
   * Returns a function that resolves a link text to a known slug.
   */
  buildLinkResolver(cards: ScannedCard[]): (link: string) => string | null {
    const slugSet = new Set(cards.map((c) => c.slug));
    // Build basename → slugs index for fallback
    const basenameIndex = new Map<string, string[]>();
    for (const card of cards) {
      const parts = card.slug.split("/");
      const base = parts[parts.length - 1];
      if (!basenameIndex.has(base)) {
        basenameIndex.set(base, []);
      }
      basenameIndex.get(base)!.push(card.slug);
    }

    return (link: string): string | null => {
      const normalised = link.replace(/\\/g, "/");
      // Exact match
      if (slugSet.has(normalised)) return normalised;
      // Basename fallback (unambiguous only)
      if (!normalised.includes("/")) {
        const matches = basenameIndex.get(normalised);
        if (matches && matches.length === 1) return matches[0];
      }
      return null;
    };
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
    // Atomic write: write to temp, then rename (prevents corruption on crash)
    const tmpPath = targetPath + ".tmp";
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);
    this.invalidateCache();
  }

  async archiveCard(slug: string): Promise<void> {
    validateSlug(slug);
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
    const dest = join(this.archiveDir, `${slug}.md`);
    // Ensure archive subdirectory exists and path is safe
    const resolvedDest = resolve(dest);
    const resolvedArchive = resolve(this.archiveDir);
    if (!resolvedDest.startsWith(resolvedArchive + sep) && resolvedDest !== resolvedArchive) {
      throw new Error(`Invalid slug: path escapes archive directory`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await rename(path, dest);
    this.invalidateCache();
  }
}
