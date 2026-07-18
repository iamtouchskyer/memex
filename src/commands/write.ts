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
  // lexical suggestions (zero network) so links grow at write time instead of
  // via a post-hoc cleanup campaign. Overwrites skip this: existing cards have
  // had their chance to be linked.
  if (isNew) {
    const suggestions = await suggestLinks(store, slug, data, content);
    if (suggestions.length > 0) {
      warnings.push(
        `Consider linking to: ${suggestions.map((s) => `[[${s}]]`).join(" ")}`,
      );
    }
  }

  return { success: true, warnings };
}
