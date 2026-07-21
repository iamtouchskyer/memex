/**
 * `memex link <from> <to> <context>` — append a single outbound wikilink from → to.
 *
 * Direction is strictly from→to and only the source file is written. Inbound
 * link count is DERIVED (it = number of cards whose body contains [[X]]), never
 * a stored field, so writing a backlink into the target would race the git
 * auto-sync (last-writer-wins clobber). One-file writes are the only safe move,
 * and they are exactly what de-orphans the target.
 *
 * A relationship context is REQUIRED, not optional. memex methodology forbids
 * bare keyword-overlap edges: a link must live in a sentence explaining WHY the
 * two cards relate (SKILL.md "links must appear in sentences explaining the
 * relationship"). Without that clause we would just be inflating the inbound
 * count with noise the retrieval layer treats as junk.
 */
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, stringifyFrontmatter, extractLinks } from "../lib/parser.js";

interface LinkResult {
  success: boolean;
  error?: string;
  message?: string;
}

export async function linkCommand(
  store: CardStore,
  from: string,
  to: string,
  context: string,
): Promise<LinkResult> {
  const relationship = context.trim();
  if (!relationship) {
    return {
      success: false,
      error: "A relationship context is required: memex link <from> <to> <why>",
    };
  }

  const fromPath = await store.resolve(from);
  if (!fromPath) return { success: false, error: `Source card not found: ${from}` };

  const toSlug = await store.resolveLink(to);
  if (!toSlug) return { success: false, error: `Target card not found: ${to}` };

  if (from === toSlug) return { success: false, error: "Cannot link a card to itself" };

  const raw = await store.readCard(from);
  const { data, content } = parseFrontmatter(raw);

  // Resolve existing wikilinks to canonical slugs before the dedup check so a
  // basename alias (e.g. [[target]] → topics/target) is not re-appended.
  const resolver = store.buildLinkResolver(await store.scanAll());
  const existing = new Set(extractLinks(content).map((l) => resolver(l) ?? l));
  if (existing.has(toSlug)) {
    return { success: true, message: `${from} already links to ${toSlug}` };
  }

  data.modified = new Date().toISOString().split("T")[0];
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }
  const newContent = `${content.trimEnd()}\n\n${relationship} [[${toSlug}]]\n`;

  await store.writeCard(from, stringifyFrontmatter(newContent, data));
  return { success: true, message: `Linked ${from} → ${toSlug} (${relationship})` };
}
