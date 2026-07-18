import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import { prepareMemexInput } from "../lib/sensitive-input.js";
import { suggestLinks } from "../lib/suggest-links.js";

const REQUIRED_FIELDS = ["title", "created", "source"];

interface WriteResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

export async function writeCommand(store: CardStore, slug: string, input: string): Promise<WriteResult> {
  const safety = prepareMemexInput(input, "content");
  if (!safety.ok) return { success: false, error: safety.error };

  const { data, content } = parseFrontmatter(safety.text);

  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length > 0) {
    return { success: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  // Normalize all date fields to YYYY-MM-DD strings
  const today = new Date().toISOString().split("T")[0];
  data.modified = today;
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }

  const output = stringifyFrontmatter(content, data);
  const isNew = !(await store.resolve(slug));
  await store.writeCard(slug, output);

  const warnings = [...(safety.warnings ?? [])];
  // New cards are born linkless — this is where orphans come from. Offer cheap
  // lexical CANDIDATES (zero network) so links grow at write time instead of via
  // a post-hoc cleanup campaign. Overwrites skip this: existing cards have had
  // their chance to be linked.
  //
  // Suggestions are advisory only. They must never turn a successful, durable
  // write into a reported failure — the card is already on disk by this point,
  // so any error while scanning for candidates is swallowed into a soft note.
  if (isNew) {
    try {
      const suggestions = await suggestLinks(store, slug, data, content);
      if (suggestions.length > 0) {
        warnings.push(
          `Link candidates (only add [[X]] if you can state the relationship): ${suggestions.map((s) => `[[${s}]]`).join(" ")}`,
        );
      }
    } catch {
      // Advisory scan failed; the write itself succeeded. Do not fail the command.
    }
  }

  return { success: true, warnings };
}
