import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";
import { MemexConfig } from "../lib/config.js";
import { join } from "node:path";

interface BacklinksOptions {
  all?: boolean;
  config?: MemexConfig;
  memexHome?: string;
}

interface BacklinksResult {
  output: string;
  exitCode: number;
}

export async function backlinksCommand(
  store: CardStore,
  slug: string,
  options: BacklinksOptions = {}
): Promise<BacklinksResult> {
  // Gather all stores to scan
  const storesToSearch: Array<{ store: CardStore; dirPrefix: string }> = [
    { store, dirPrefix: "cards" },
  ];

  // Add additional search directories if --all is set
  if (options.all && options.config?.searchDirs && options.config.searchDirs.length > 0 && options.memexHome) {
    const archiveDir = join(options.memexHome, "archive");
    for (const searchDir of options.config.searchDirs) {
      const fullPath = join(options.memexHome, searchDir);
      const additionalStore = new CardStore(fullPath, archiveDir, store["nestedSlugs"]);
      const dirName = searchDir.split("/").pop() || searchDir;
      storesToSearch.push({ store: additionalStore, dirPrefix: dirName });
    }
  }

  const backlinks: Array<{ slug: string; dirPrefix: string }> = [];

  for (const { store: s, dirPrefix } of storesToSearch) {
    const cards = await s.scanAll();
    for (const card of cards) {
      const raw = await s.readCard(card.slug);
      const { content } = parseFrontmatter(raw);
      const links = extractLinks(content);
      if (links.includes(slug)) {
        backlinks.push({ slug: card.slug, dirPrefix });
      }
    }
  }

  if (backlinks.length === 0) {
    return { output: `No backlinks found for ${slug}`, exitCode: 0 };
  }

  const lines = backlinks.map((b) => `  - ${b.slug} (${b.dirPrefix}/)`);
  const output = `Backlinks for ${slug}:\n${lines.join("\n")}`;
  return { output, exitCode: 0 };
}
