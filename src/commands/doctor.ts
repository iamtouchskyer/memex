import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";

export interface DoctorResult {
  exitCode: number;
  output?: string;
}

export interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  details?: string[];
}

interface CollisionGroup {
  slug: string;
  paths: string[];
  fullPaths: string[];
}

export async function checkCollisions(
  cardsDir: string,
  archiveDir: string
): Promise<CheckResult> {
  try {
    const basenameStore = new CardStore(cardsDir, archiveDir, false);
    const cards = await basenameStore.scanAll();

    const slugMap = new Map<string, string[]>();
    for (const card of cards) {
      if (!slugMap.has(card.slug)) {
        slugMap.set(card.slug, []);
      }
      slugMap.get(card.slug)!.push(card.path);
    }

    const collisions: CollisionGroup[] = [];
    for (const [slug, paths] of slugMap.entries()) {
      if (paths.length > 1) {
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
        name: "Slug collisions",
        status: "ok",
        message: "none found",
      };
    }

    const details = collisions
      .map((c) => `  "${c.slug}" → ${c.paths.join(", ")}`)
      .join("\n");
    return {
      name: "Slug collisions",
      status: "error",
      message: `${collisions.length} collision(s) found\n${details}`,
    };
  } catch (e) {
    return {
      name: "Slug collisions",
      status: "error",
      message: `check failed: ${(e as Error).message}`,
    };
  }
}

export async function checkOrphans(
  cardsDir: string,
  archiveDir: string,
  verbose?: boolean
): Promise<CheckResult> {
  try {
    const store = new CardStore(cardsDir, archiveDir, true);
    const cards = await store.scanAll();
    if (cards.length === 0) {
      return { name: "Orphans", status: "ok", message: "no cards found" };
    }

    const inboundMap = new Map<string, number>();
    for (const card of cards) {
      inboundMap.set(card.slug, 0);
    }

    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { content } = parseFrontmatter(raw);
      const links = extractLinks(content);
      for (const link of links) {
        if (inboundMap.has(link)) {
          inboundMap.set(link, (inboundMap.get(link) || 0) + 1);
        }
      }
    }

    const orphans = Array.from(inboundMap.entries())
      .filter(([, count]) => count === 0)
      .map(([slug]) => slug);

    if (orphans.length === 0) {
      return { name: "Orphans", status: "ok", message: "all cards have inbound links" };
    }

    const pct = ((orphans.length / cards.length) * 100).toFixed(0);
    let message = `${orphans.length} cards (${pct}%) have no inbound links`;
    if (verbose) {
      message += "\n" + orphans.map((s) => `  ${s}`).join("\n");
    }
    return {
      name: "Orphans",
      status: "warn",
      message,
      details: orphans,
    };
  } catch (e) {
    return {
      name: "Orphans",
      status: "error",
      message: `check failed: ${(e as Error).message}`,
    };
  }
}

export async function checkBrokenLinks(
  cardsDir: string,
  archiveDir: string,
  verbose?: boolean
): Promise<CheckResult> {
  try {
    const store = new CardStore(cardsDir, archiveDir, true);
    const cards = await store.scanAll();
    const knownSlugs = new Set(cards.map((c) => c.slug));
    const broken: { from: string; to: string }[] = [];

    for (const card of cards) {
      const raw = await store.readCard(card.slug);
      const { content } = parseFrontmatter(raw);
      const links = extractLinks(content);
      for (const link of links) {
        if (!knownSlugs.has(link)) {
          broken.push({ from: card.slug, to: link });
        }
      }
    }

    if (broken.length === 0) {
      return { name: "Broken links", status: "ok", message: "none found" };
    }

    let message = `${broken.length} link(s) to non-existent cards`;
    if (verbose) {
      const detailLines = broken.map((b) => `  ${b.from} → ${b.to}`).join("\n");
      message += "\n" + detailLines;
    }

    return {
      name: "Broken links",
      status: "warn",
      message,
      details: broken.map((b) => `${b.from} → ${b.to}`),
    };
  } catch (e) {
    return {
      name: "Broken links",
      status: "error",
      message: `check failed: ${(e as Error).message}`,
    };
  }
}

function formatCheckResult(r: CheckResult): string {
  const icon = r.status === "ok" ? "✓" : r.status === "warn" ? "⚠" : "✗";
  return `${icon} ${r.name}: ${r.message}`;
}

export async function doctorRunAll(
  cardsDir: string,
  archiveDir: string,
  verbose?: boolean,
  json?: boolean
): Promise<DoctorResult> {
  const results = await Promise.all([
    checkCollisions(cardsDir, archiveDir),
    checkOrphans(cardsDir, archiveDir, verbose),
    checkBrokenLinks(cardsDir, archiveDir, verbose),
  ]);

  const hasError = results.some((r) => r.status === "error");

  if (json) {
    const jsonOutput = results.map((r) => ({
      name: r.name,
      status: r.status,
      ...(r.details ? { details: r.details } : {}),
    }));
    return { exitCode: hasError ? 1 : 0, output: JSON.stringify(jsonOutput, null, 2) };
  }

  const output = results.map(formatCheckResult).join("\n");
  return { exitCode: hasError ? 1 : 0, output };
}

/** Legacy entry point for backward compat (collision check only) — preserves original output format */
export async function doctorCommand(
  cardsDir: string,
  archiveDir: string
): Promise<DoctorResult> {
  try {
    const basenameStore = new CardStore(cardsDir, archiveDir, false);
    const cards = await basenameStore.scanAll();

    const slugMap = new Map<string, string[]>();
    for (const card of cards) {
      if (!slugMap.has(card.slug)) {
        slugMap.set(card.slug, []);
      }
      slugMap.get(card.slug)!.push(card.path);
    }

    const collisions: CollisionGroup[] = [];
    for (const [slug, paths] of slugMap.entries()) {
      if (paths.length > 1) {
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

    return { exitCode: 1, output: lines.join("\n") };
  } catch (e) {
    return {
      exitCode: 1,
      output: `Error checking collisions: ${(e as Error).message}`,
    };
  }
}
