import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import { autoSync } from "../lib/sync.js";
import { dirname } from "node:path";

const REQUIRED_FIELDS = ["title", "created", "source"];

/** Characters that are invalid in a slug component */
const INVALID_SLUG_RE = /[\\:*?"<>|]/;

export function validateSlug(slug: string): string | null {
  if (!slug || slug.trim() === "") {
    return "Slug must not be empty";
  }
  // Reject slugs that are only slashes or dots
  if (/^[./\\]+$/.test(slug)) {
    return `Invalid slug: '${slug}'`;
  }
  // Reject OS-reserved characters on Windows / problematic in URLs
  const parts = slug.split("/");
  for (const part of parts) {
    if (!part) return `Invalid slug: empty path segment in '${slug}'`;
    if (INVALID_SLUG_RE.test(part)) {
      return `Invalid slug: '${slug}' contains reserved characters (\\:*?"<>|)`;
    }
  }
  return null;
}

interface WriteResult {
  success: boolean;
  error?: string;
}

export async function writeCommand(store: CardStore, slug: string, input: string): Promise<WriteResult> {
  const slugError = validateSlug(slug);
  if (slugError) {
    return { success: false, error: slugError };
  }

  const { data, content } = parseFrontmatter(input);

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
  await autoSync(dirname(store.cardsDir));
  return { success: true };
}
