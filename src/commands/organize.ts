import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";
import { formatLinkStats } from "../lib/formatter.js";

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val || "");
}

interface OrganizeResult {
  output: string;
  exitCode: number;
}

export async function organizeCommand(
  store: CardStore,
  lastOrganize: string | null,
  json?: boolean,
): Promise<OrganizeResult> {
  const cards = await store.scanAll();
  if (cards.length === 0) return { output: "No cards yet.", exitCode: 0 };

  // Build link graph
  const outboundMap = new Map<string, string[]>();
  const inboundMap = new Map<string, string[]>();
  const cardData = new Map<string, { title: string; modified: string; status: string; content: string }>();

  for (const card of cards) {
    inboundMap.set(card.slug, []);
  }

  for (const card of cards) {
    const raw = await store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    outboundMap.set(card.slug, links);
    cardData.set(card.slug, {
      title: String(data.title || card.slug),
      modified: toDateString(data.modified || ""),
      status: String(data.status || ""),
      content: content.trim(),
    });

    for (const link of links) {
      const existing = inboundMap.get(link) || [];
      existing.push(card.slug);
      inboundMap.set(link, existing);
    }
  }

  // Link stats
  const stats = cards.map((card) => ({
    slug: card.slug,
    outbound: (outboundMap.get(card.slug) || []).length,
    inbound: (inboundMap.get(card.slug) || []).length,
  }));

  const sections: string[] = [];
  sections.push("# Organize Report\n");
  sections.push("## Link Stats\n" + formatLinkStats(stats));

  // Orphans
  const orphans = stats.filter((s) => s.inbound === 0 && s.slug !== "index");
  if (orphans.length > 0) {
    sections.push(
      "## Orphans (no inbound links)\n" +
      orphans.map((o) => `- ${o.slug} — ${cardData.get(o.slug)?.title}`).join("\n"),
    );
  }

  // Hubs
  const hubs = stats.filter((s) => s.inbound >= 10);
  if (hubs.length > 0) {
    sections.push(
      "## Hubs (≥10 inbound links)\n" +
      hubs.map((h) => `- ${h.slug} (${h.inbound} inbound) — ${cardData.get(h.slug)?.title}`).join("\n"),
    );
  }

  // Conflict cards (collected from first pass, no extra reads)
  const conflicts: string[] = [];
  for (const card of cards) {
    if (cardData.get(card.slug)?.status === "conflict") {
      conflicts.push(card.slug);
    }
  }
  if (conflicts.length > 0) {
    sections.push(
      "## Unresolved Conflicts\n" +
      conflicts.map((slug) => `- ${slug} — ${cardData.get(slug)?.title}`).join("\n"),
    );
  }

  // Recently modified cards + neighbors
  const recentCards: string[] = [];
  if (lastOrganize) {
    for (const card of cards) {
      const info = cardData.get(card.slug);
      // Include cards with no date (conservative: better to over-check than miss)
      if (info && (!info.modified || info.modified >= lastOrganize)) {
        recentCards.push(card.slug);
      }
    }
  } else {
    // First run: all cards are "recent"
    for (const card of cards) {
      recentCards.push(card.slug);
    }
  }

  // Build recent pairs data
  const recentPairs: { slug1: string; slug2: string; title1: string; title2: string }[] = [];
  if (recentCards.length > 0) {
    const seen = new Set<string>();

    for (const slug of recentCards) {
      const info = cardData.get(slug);
      if (!info) continue;

      const neighbors = outboundMap.get(slug) || [];
      for (const neighbor of neighbors) {
        const neighborInfo = cardData.get(neighbor);
        if (!neighborInfo) continue;

        const pairKey = [slug, neighbor].sort().join("↔");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        recentPairs.push({
          slug1: slug,
          slug2: neighbor,
          title1: info.title,
          title2: neighborInfo.title,
        });
      }
    }
  }

  // Cap at 20 pairs
  const cappedPairs = recentPairs.slice(0, 20);

  if (json) {
    const jsonOutput = {
      stats,
      orphans: orphans.map((o) => ({ slug: o.slug, title: cardData.get(o.slug)?.title ?? o.slug })),
      hubs: hubs.map((h) => ({ slug: h.slug, title: cardData.get(h.slug)?.title ?? h.slug, inbound: h.inbound })),
      conflicts: conflicts.map((slug) => ({ slug, title: cardData.get(slug)?.title ?? slug })),
      recentPairs: cappedPairs,
    };
    return { output: JSON.stringify(jsonOutput, null, 2), exitCode: 0 };
  }

  if (cappedPairs.length > 0) {
    const pairSections = cappedPairs.map((p) => {
      const info1 = cardData.get(p.slug1)!;
      const info2 = cardData.get(p.slug2)!;
      return (
        `### ${p.slug1} ↔ ${p.slug2}\n` +
        `**${p.slug1}** (${p.title1}):\n${info1.content.slice(0, 300)}\n\n` +
        `**${p.slug2}** (${p.title2}):\n${info2.content.slice(0, 300)}`
      );
    });
    sections.push(
      "## Recently Modified Cards + Neighbors (check for contradictions)\n" +
      pairSections.join("\n\n") +
      (recentPairs.length > 20
        ? `\n\n... and ${recentPairs.length - 20} more pairs not shown. Run with a recent \`since\` date for targeted checks.`
        : ""),
    );
  }

  return { output: sections.join("\n\n"), exitCode: 0 };
}
