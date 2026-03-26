import { CardStore } from "../lib/store.js";

interface DoctorResult {
  exitCode: number;
  output?: string;
}

interface CollisionGroup {
  slug: string;
  paths: string[];
  fullPaths: string[];
}

export async function doctorCommand(
  cardsDir: string,
  archiveDir: string
): Promise<DoctorResult> {
  try {
    // Scan with basename mode (nestedSlugs=false) to find collisions
    const basenameStore = new CardStore(cardsDir, archiveDir, false);
    const cards = await basenameStore.scanAll();

    // Group by slug to find collisions
    const slugMap = new Map<string, string[]>();
    for (const card of cards) {
      if (!slugMap.has(card.slug)) {
        slugMap.set(card.slug, []);
      }
      slugMap.get(card.slug)!.push(card.path);
    }

    // Find collision groups (slugs with multiple paths)
    const collisions: CollisionGroup[] = [];
    for (const [slug, paths] of slugMap.entries()) {
      if (paths.length > 1) {
        // Get full paths using nested mode
        const nestedStore = new CardStore(cardsDir, archiveDir, true);
        const nestedCards = await nestedStore.scanAll();
        const fullPaths = paths.map((path) => {
          const found = nestedCards.find((c) => c.path === path);
          return found?.slug ?? path;
        });

        collisions.push({ slug, paths, fullPaths });
      }
    }

    if (collisions.length === 0) {
      return {
        exitCode: 0,
        output: "No slug collisions found. Safe to enable nestedSlugs.",
      };
    }

    // Build collision report
    const lines: string[] = [`Found ${collisions.length} slug collision(s):\n`];
    for (const collision of collisions) {
      lines.push(`Slug "${collision.slug}" collides:`);
      for (let i = 0; i < collision.paths.length; i++) {
        lines.push(`  - ${collision.paths[i]}`);
        lines.push(`    (would become: ${collision.fullPaths[i]})`);
      }
      lines.push("");
    }
    lines.push("Resolve these collisions before enabling nestedSlugs.");

    return {
      exitCode: 1,
      output: lines.join("\n"),
    };
  } catch (e) {
    return {
      exitCode: 1,
      output: `Error checking collisions: ${(e as Error).message}`,
    };
  }
}
