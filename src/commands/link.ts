/**
 * `memex link <from> <to>` — append a single outbound wikilink from → to.
 *
 * Direction is strictly from→to and only the source file is written. Inbound
 * link count is DERIVED (it = number of cards whose body contains [[X]]), never
 * a stored field, so writing a backlink into the target would race the git
 * auto-sync (last-writer-wins clobber). One-file writes are the only safe move,
 * and they are exactly what de-orphans the target.
 */
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, stringifyFrontmatter, extractLinks } from "../lib/parser.js";

interface LinkResult {
  success: boolean;
  error?: string;
  message?: string;
}

export async function linkCommand(store: CardStore, from: string, to: string): Promise<LinkResult> {
  const fromPath = await store.resolve(from);
  if (!fromPath) return { success: false, error: `Source card not found: ${from}` };

  const toSlug = await store.resolveLink(to);
  if (!toSlug) return { success: false, error: `Target card not found: ${to}` };

  if (from === toSlug) return { success: false, error: "Cannot link a card to itself" };

  const raw = await store.readCard(from);
  const { data, content } = parseFrontmatter(raw);

  if (extractLinks(content).includes(toSlug)) {
    return { success: true, message: `${from} already links to ${toSlug}` };
  }

  data.modified = new Date().toISOString().split("T")[0];
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }
  const newContent = `${content.trimEnd()}\n\nRelated: [[${toSlug}]]\n`;

  await store.writeCard(from, stringifyFrontmatter(newContent, data));
  return { success: true, message: `Linked ${from} → ${toSlug}` };
}
