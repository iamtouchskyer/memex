import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import { prepareMemexInput } from "../lib/sensitive-input.js";

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
  await store.writeCard(slug, output);
  return { success: true, warnings: safety.warnings };
}
