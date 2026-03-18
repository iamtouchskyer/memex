import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

interface ScannedCard {
  slug: string;
  path: string;
}

export class CardStore {
  constructor(
    public readonly cardsDir: string,
    private archiveDir: string
  ) {}

  async scanAll(): Promise<ScannedCard[]> {
    const results: ScannedCard[] = [];
    await this.walkDir(this.cardsDir, results);
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

  async writeCard(slug: string, content: string): Promise<void> {
    const existing = await this.resolve(slug);
    const targetPath = existing ?? join(this.cardsDir, `${slug}.md`);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf-8");
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
  }
}
