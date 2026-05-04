import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import { autoSync } from "../lib/sync.js";

// ── Config ──────────────────────────────────────────────────────────

interface FlomoConfig {
  webhookUrl?: string;
}

const FLOMO_WEBHOOK_PREFIX = "https://flomoapp.com/iwh/";

function isValidFlomoWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "flomoapp.com" && parsed.pathname.startsWith("/iwh/") && !parsed.pathname.includes("..");
  } catch {
    return false;
  }
}

export async function readFlomoConfig(memexHome: string): Promise<FlomoConfig> {
  const configPath = join(memexHome, ".memexrc");
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    const url = typeof parsed.flomoWebhookUrl === "string" ? parsed.flomoWebhookUrl : undefined;
    // Validate URL at read time too (defense in depth)
    if (url && !isValidFlomoWebhookUrl(url)) return {};
    return { webhookUrl: url };
  } catch {
    return {};
  }
}

export async function writeFlomoConfig(memexHome: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
  if (!isValidFlomoWebhookUrl(webhookUrl)) {
    return { success: false, error: "Invalid flomo webhook URL. Must be https://flomoapp.com/iwh/..." };
  }

  const configPath = join(memexHome, ".memexrc");
  let existing: Record<string, unknown> = {};
  try {
    const content = await readFile(configPath, "utf-8");
    existing = JSON.parse(content);
  } catch {
    // File doesn't exist or invalid — start fresh
  }
  existing.flomoWebhookUrl = webhookUrl;
  await writeFile(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  return { success: true };
}

export async function flomoConfigCommand(
  memexHome: string,
  opts: { setWebhook?: string; show?: boolean }
): Promise<{ output: string; exitCode: number }> {
  if (opts.setWebhook) {
    const result = await writeFlomoConfig(memexHome, opts.setWebhook);
    if (!result.success) {
      return { output: `Error: ${result.error}`, exitCode: 1 };
    }
    return { output: "Flomo webhook URL configured.", exitCode: 0 };
  }

  // Default: show
  const config = await readFlomoConfig(memexHome);
  if (config.webhookUrl) {
    return { output: `Flomo webhook URL: ${config.webhookUrl}`, exitCode: 0 };
  }
  return { output: "Flomo webhook URL: (not configured)\nSet with: memex flomo config --set-webhook <url>", exitCode: 0 };
}

// ── Push ────────────────────────────────────────────────────────────

interface PushResult {
  slug: string;
  status: "pushed" | "skipped" | "error";
  message?: string;
}

function cardToFlomoContent(data: Record<string, unknown>, body: string): string {
  const parts: string[] = [];

  // Add title as first line
  if (data.title) {
    parts.push(`# ${data.title}`);
    parts.push("");
  }

  // Add body
  parts.push(body.trim());

  // Add tags from frontmatter
  const tags: string[] = [];
  if (typeof data.category === "string") tags.push(`#${data.category}`);
  if (typeof data.source === "string") tags.push(`#memex/${data.source}`);
  if (typeof data.tags === "string") {
    data.tags.split(/[,\s]+/).filter(Boolean).forEach((t: string) => {
      tags.push(t.startsWith("#") ? t : `#${t}`);
    });
  } else if (Array.isArray(data.tags)) {
    (data.tags as string[]).forEach((t: string) => {
      const s = String(t).trim();
      if (s) tags.push(s.startsWith("#") ? s : `#${s}`);
    });
  }
  if (tags.length > 0) {
    parts.push("");
    parts.push(tags.join(" "));
  }

  return parts.join("\n");
}

async function pushSingleCard(
  store: CardStore,
  slug: string,
  webhookUrl: string,
  dryRun: boolean,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<PushResult> {
  let raw: string;
  try {
    raw = await store.readCard(slug);
  } catch {
    return { slug, status: "error", message: `Card not found: ${slug}` };
  }

  const { data, content } = parseFrontmatter(raw);

  // Anti-loopback: never push flomo-sourced cards back to flomo
  if (data.source === "flomo") {
    return { slug, status: "skipped", message: "Skipped: flomo-sourced card (anti-loopback)" };
  }

  // Skip if already pushed
  if (data.flomoPushedAt) {
    return { slug, status: "skipped", message: `Already pushed at ${data.flomoPushedAt}` };
  }

  const flomoContent = cardToFlomoContent(data, content);

  if (dryRun) {
    return { slug, status: "pushed", message: `[dry-run] Would push:\n${flomoContent}` };
  }

  try {
    const response = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: flomoContent }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { slug, status: "error", message: `HTTP ${response.status}: ${await response.text()}` };
    }

    const result = await response.json() as { code: number; message: string };
    if (result.code !== 0) {
      return { slug, status: "error", message: `Flomo error: ${result.message}` };
    }

    // Record push timestamp in card frontmatter
    data.flomoPushedAt = new Date().toISOString().split("T")[0];
    const updated = stringifyFrontmatter(content, data);
    await store.writeCard(slug, updated);

    return { slug, status: "pushed", message: "OK" };
  } catch (e) {
    return { slug, status: "error", message: `Network error: ${(e as Error).message}` };
  }
}

// ── Import ──────────────────────────────────────────────────────────

export interface FlomoMemo {
  timestamp: string;
  content: string;
  tags: string[];
  slug: string;
  title: string;
}

/**
 * Parse flomo HTML export into structured memos.
 * Flomo HTML structure:
 *   <div class="memos">
 *     <div class="memo">
 *       <div class="time">2021-03-29 18:07:06</div>
 *       <div class="content"><p>...</p></div>
 *       <div class="files">...</div>
 *     </div>
 *   </div>
 */
export function parseFlomoHtml(html: string): FlomoMemo[] {
  const memos: FlomoMemo[] = [];

  // Split on memo boundaries — more robust than single regex with nested divs
  const parts = html.split(/<div\s+class="memo">/);
  // First part is everything before the first memo — skip it
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    // Extract timestamp
    const timeMatch = block.match(/<div\s+class="time">\s*([\s\S]*?)\s*<\/div>/);
    const timestamp = timeMatch ? timeMatch[1].trim() : "";

    // Extract content div — use greedy match anchored on the files div to handle nested divs
    const contentMatch = block.match(/<div\s+class="content">([\s\S]*?)<\/div>\s*<div\s+class="files"[^>]*>/);
    const rawContent = contentMatch ? contentMatch[1] : "";

    // Convert HTML content to markdown
    const markdown = htmlToMarkdown(rawContent);

    // Extract hashtags from content
    const tagMatches = markdown.match(/#[\w\u4e00-\u9fff/]+/g) || [];
    const tags = [...new Set(tagMatches.map(t => t.replace(/^#/, "")))];

    // Generate title: first line or first 50 chars
    const firstLine = markdown.split("\n").find(l => l.trim().length > 0) || "Untitled";
    const title = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;

    // Generate slug from content (pass index to disambiguate all-Chinese memos)
    const slug = generateSlug(title, i);

    memos.push({ timestamp, content: markdown, tags, slug, title });
  }

  return memos;
}

function htmlToMarkdown(html: string): string {
  let md = html;

  // Handle line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Bold
  md = md.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");

  // Italic
  md = md.replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");

  // Links
  md = md.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // List items
  md = md.replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Paragraphs → double newline
  md = md.replace(/<\/p>\s*<p>/gi, "\n\n");
  md = md.replace(/<\/?p>/gi, "");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

function generateSlug(text: string, index?: number): string {
  // Remove markdown formatting
  let slug = text.replace(/[*_#\[\]()]/g, "");
  // Remove Chinese characters for slug, keep alphanumeric
  slug = slug.replace(/[^\w\s-]/g, "");
  // Convert to kebab-case
  slug = slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
  // Limit length
  slug = slug.slice(0, 60).replace(/-$/, "");
  // Fallback: if slug is empty (all-Chinese content), use flomo-memo with index
  if (!slug) {
    slug = index !== undefined ? `flomo-memo-${index}` : "flomo-memo";
  }
  return slug;
}

export async function flomoImportCommand(
  store: CardStore,
  filePath: string,
  opts: { dryRun?: boolean },
): Promise<{ output: string; exitCode: number }> {
  let html: string;
  try {
    html = await readFile(filePath, "utf-8");
  } catch {
    return { output: `Error: Cannot read file: ${filePath}`, exitCode: 1 };
  }

  const memos = parseFlomoHtml(html);
  if (memos.length === 0) {
    return { output: "No memos found in the HTML file. Expected flomo export format.", exitCode: 1 };
  }

  const lines: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const memo of memos) {
    // Check for slug conflict — try incrementing suffixes
    let slug = memo.slug;
    if (await store.resolve(slug)) {
      let found = false;
      for (let n = 1; n <= 100; n++) {
        const candidate = n === 1 ? `${memo.slug}-flomo` : `${memo.slug}-flomo-${n}`;
        if (!(await store.resolve(candidate))) {
          slug = candidate;
          found = true;
          break;
        }
      }
      if (!found) {
        lines.push(`⏭ ${memo.slug}: too many slug conflicts, skipping`);
        skipped++;
        continue;
      }
    }

    // Parse timestamp
    const dateStr = memo.timestamp.split(" ")[0] || new Date().toISOString().split("T")[0];

    const data: Record<string, unknown> = {
      title: memo.title,
      created: dateStr,
      source: "flomo",
    };
    if (memo.tags.length > 0) {
      data.tags = memo.tags.join(", ");
    }

    if (opts.dryRun) {
      lines.push(`+ ${slug}: "${memo.title}" (${dateStr}, ${memo.tags.length} tags)`);
      created++;
      continue;
    }

    const cardContent = stringifyFrontmatter(
      memo.content,
      data,
    );
    await store.writeCard(slug, cardContent);
    lines.push(`✓ ${slug}: "${memo.title}"`);
    created++;
  }

  if (!opts.dryRun && created > 0) {
    await autoSync(dirname(store.cardsDir));
  }

  lines.push("");
  const prefix = opts.dryRun ? "[dry-run] " : "";
  lines.push(`${prefix}Summary: ${created} ${opts.dryRun ? "would create" : "created"}, ${skipped} skipped`);

  return { output: lines.join("\n"), exitCode: 0 };
}

export async function flomoPushCommand(
  store: CardStore,
  memexHome: string,
  slugOrOpts: string | undefined,
  opts: {
    all?: boolean;
    source?: string;
    tag?: string;
    dryRun?: boolean;
    fetchFn?: typeof globalThis.fetch;
  },
): Promise<{ output: string; exitCode: number }> {
  const config = await readFlomoConfig(memexHome);
  if (!config.webhookUrl) {
    return {
      output: "Error: Flomo webhook URL not configured.\nRun: memex flomo config --set-webhook <url>",
      exitCode: 1,
    };
  }

  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const dryRun = opts.dryRun ?? false;

  // Determine which cards to push
  let slugs: string[];

  if (slugOrOpts && !opts.all) {
    // Single card
    slugs = [slugOrOpts];
  } else {
    // Batch: scan all cards and filter
    const all = await store.scanAll();
    const filteredSlugs: string[] = [];

    for (const card of all) {
      const raw = await store.readCard(card.slug);
      const { data } = parseFrontmatter(raw);

      // Anti-loopback: never push flomo-sourced cards back to flomo
      if (data.source === "flomo") continue;
      if (opts.source && data.source !== opts.source) continue;
      if (opts.tag) {
        const tagSet = new Set<string>();
        if (typeof data.tags === "string") {
          data.tags.split(/[,\s]+/).filter(Boolean).forEach((t: string) => tagSet.add(t));
        } else if (Array.isArray(data.tags)) {
          (data.tags as string[]).forEach((t: string) => tagSet.add(String(t).trim()));
        }
        const cardCategory = typeof data.category === "string" ? data.category : "";
        if (!tagSet.has(opts.tag) && cardCategory !== opts.tag) continue;
      }

      filteredSlugs.push(card.slug);
    }
    slugs = filteredSlugs;
  }

  if (slugs.length === 0) {
    return { output: "No cards matched the filter criteria.", exitCode: 0 };
  }

  const results: PushResult[] = [];
  for (const slug of slugs) {
    const result = await pushSingleCard(store, slug, config.webhookUrl, dryRun, fetchFn);
    results.push(result);
  }

  // Sync after push if any cards were modified
  if (!dryRun && results.some(r => r.status === "pushed")) {
    await autoSync(dirname(store.cardsDir));
  }

  const pushed = results.filter(r => r.status === "pushed").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  const errors = results.filter(r => r.status === "error").length;

  const lines: string[] = [];
  for (const r of results) {
    const icon = r.status === "pushed" ? "✓" : r.status === "skipped" ? "⏭" : "✗";
    lines.push(`${icon} ${r.slug}: ${r.message}`);
  }

  lines.push("");
  lines.push(`Summary: ${pushed} pushed, ${skipped} skipped, ${errors} errors`);

  return {
    output: lines.join("\n"),
    exitCode: errors > 0 ? 1 : 0,
  };
}
