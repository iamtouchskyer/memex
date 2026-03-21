import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, relative, dirname, resolve, sep } from "node:path";

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
        // Use relative path from cardsDir as slug (preserves subdirectory structure).
        // Normalize path separator to "/" for cross-platform consistency (Windows uses "\").
        const relPath = relative(this.cardsDir, fullPath);
        const slug = relPath.replace(/\.md$/, "").split(sep).join("/");
        results.push({ slug, path: fullPath });
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
    if (!resolved.startsWith(cardsResolved + "/") && resolved !== cardsResolved) {
      throw new Error(`Invalid slug: path escapes cards directory`);
    }
  }

  async writeCard(slug: string, content: string): Promise<void> {
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
    // Preserve subdirectory structure in archive (slug may contain path separators)
    const dest = join(this.archiveDir, `${slug}.md`);
    await mkdir(dirname(dest), { recursive: true });
    await rename(path, dest);
    this.invalidateCache();
  }
}
