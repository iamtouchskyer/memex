import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { HookRegistry } from "../lib/hooks.js";
import { searchCommand } from "../commands/search.js";
import type { ManifestFilter } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { organizeCommand } from "../commands/organize.js";
import { stringifyFrontmatter } from "../lib/parser.js";
import { GitAdapter, readSyncConfig } from "../lib/sync.js";
import { flomoPushCommand, parseFlomoHtml } from "../commands/flomo.js";
import type { FlomoMemo } from "../commands/flomo.js";
import { z } from "zod";

export function registerOperations(
  server: McpServer,
  store: CardStore,
  hooks: HookRegistry,
  home: string,
  getClientName: () => string,
): void {
  // ---- recall ----
  server.registerTool("memex_recall", {
    description: "IMPORTANT: You MUST call this at the START of every new task or conversation, BEFORE doing any work. This retrieves your persistent memory — knowledge cards from previous sessions with [[bidirectional links]]. Returns the keyword index (if exists) or card list. Optionally search by query. Without calling this first, you will miss context from prior sessions and repeat past mistakes.",
    inputSchema: z.object({
      query: z.string().optional().describe("Optional search query to find specific cards"),
      category: z.string().optional().describe("Filter by frontmatter category"),
      tag: z.string().optional().describe("Filter by frontmatter tag"),
      author: z.string().optional().describe("Filter by frontmatter author/source"),
      since: z.string().optional().describe("Only cards created/modified after this date (YYYY-MM-DD)"),
      before: z.string().optional().describe("Only cards created/modified before this date (YYYY-MM-DD)"),
    }),
  }, async ({ query, category, tag, author, since, before }) => {
    await hooks.run("pre", "recall");

    const filter: ManifestFilter | undefined = (category || tag || author || since || before)
      ? { category, tag, author, since, before }
      : undefined;

    if (query) {
      const result = await searchCommand(store, query, { limit: 10, filter });
      return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
    }

    // Try index first, fall back to card list
    if (!filter) {
      const indexResult = await readCommand(store, "index");
      if (indexResult.success) {
        return { content: [{ type: "text" as const, text: indexResult.content! }] };
      }
    }

    const listResult = await searchCommand(store, undefined, { filter });
    return { content: [{ type: "text" as const, text: listResult.output || "No cards yet." }] };
  });

  // ---- retro ----
  server.registerTool("memex_retro", {
    description: "IMPORTANT: Call this at the END of every task to save what you learned. Write one atomic insight per card with [[wikilinks]] to related cards. Only save non-obvious learnings — things that would be useful in future sessions (architecture decisions, gotchas, patterns discovered, bug root causes). Handles frontmatter, source tagging, and cross-device sync automatically.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case"),
      title: z.string().describe("Card title (keep short, ≤60 chars, noun phrase not full sentence)"),
      body: z.string().describe("Card body in markdown with [[wikilinks]]"),
      category: z.string().optional().describe("Category (e.g. frontend, architecture, devops, bugfix)"),
    }),
  }, async ({ slug, title, body, category }) => {
    await hooks.run("pre", "retro");

    const today = new Date().toISOString().split("T")[0];
    const data: Record<string, unknown> = {
      title,
      created: today,
      source: getClientName(),
    };
    if (category) data.category = category;
    const content = stringifyFrontmatter(body, data);

    const result = await writeCommand(store, slug, content);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }

    await hooks.run("post", "retro");

    // Upsell sync if not configured
    const config = await readSyncConfig(home);
    const tip = !config.remote
      ? "\n\nTip: To sync cards across devices, tell the user to run in terminal: npx @touchskyer/memex sync --init && npx @touchskyer/memex sync on"
      : "";

    return { content: [{ type: "text" as const, text: `Card '${slug}' saved.${tip}` }] };
  });

  // ---- organize ----
  server.registerTool("memex_organize", {
    description: "Analyze the card network for maintenance. Returns link stats, orphans, hubs, unresolved conflicts, and recently modified cards paired with their neighbors for contradiction detection. Call this periodically to keep the knowledge graph healthy.",
    inputSchema: z.object({
      since: z.string().optional().describe("Only check cards modified since this date (YYYY-MM-DD). Omit for full scan."),
    }),
  }, async ({ since }) => {
    await hooks.run("pre", "organize");

    const result = await organizeCommand(store, since ?? null);

    await hooks.run("post", "organize");

    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  // ---- pull ----
  server.registerTool("memex_pull", {
    description: "Pull latest cards from remote to get changes from other devices. If sync is not configured, DO NOT attempt to set it up yourself — tell the user to run these exact commands in their terminal: npx @touchskyer/memex sync --init && npx @touchskyer/memex sync on (this auto-creates a private 'memex-cards' repo on GitHub, requires gh CLI).",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "pull");

    const config = await readSyncConfig(home);
    if (!config.remote) {
      return { content: [{ type: "text" as const, text: "Sync not configured. DO NOT set this up yourself. Tell the user to run in their terminal: npx @touchskyer/memex sync --init && npx @touchskyer/memex sync on" }] };
    }
    const adapter = new GitAdapter(home);
    const result = await adapter.pull();

    await hooks.run("post", "pull");

    return { content: [{ type: "text" as const, text: result.message }], isError: !result.success };
  });

  // ---- push ----
  server.registerTool("memex_push", {
    description: "Push local cards to remote to sync to other devices. If sync is not configured, DO NOT attempt to set it up yourself — tell the user to run these exact commands in their terminal: npx @touchskyer/memex sync --init && npx @touchskyer/memex sync on (this auto-creates a private 'memex-cards' repo on GitHub, requires gh CLI).",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "push");

    const config = await readSyncConfig(home);
    if (!config.remote) {
      return { content: [{ type: "text" as const, text: "Sync not configured. DO NOT set this up yourself. Tell the user to run in their terminal: npx @touchskyer/memex sync --init && npx @touchskyer/memex sync on" }] };
    }
    const adapter = new GitAdapter(home);
    const result = await adapter.push();

    await hooks.run("post", "push");

    return { content: [{ type: "text" as const, text: result.message }], isError: !result.success };
  });

  // ---- flomo_push ----
  server.registerTool("flomo_push", {
    description: "Push a memex card to flomo. Requires flomo webhook URL configured via `memex flomo config --set-webhook`. Use dry_run to preview.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug to push to flomo"),
      dry_run: z.boolean().optional().describe("Preview without pushing"),
    }),
  }, async ({ slug, dry_run }) => {
    const result = await flomoPushCommand(store, home, slug, { dryRun: dry_run });
    return { content: [{ type: "text" as const, text: result.output }], isError: result.exitCode !== 0 };
  });

  // ---- flomo_import_parse ----
  server.registerTool("flomo_import_parse", {
    description: "Parse a flomo HTML export file and return structured memo data. Use this to review memos before importing them as memex cards. The agent can then curate, group, and rewrite memos into Zettelkasten-style cards using memex_write. File must be an .html/.htm file.",
    inputSchema: z.object({
      file_path: z.string().describe("Path to flomo HTML export file (.html or .htm)"),
    }),
  }, async ({ file_path }) => {
    const { readFile } = await import("node:fs/promises");
    const { resolve, extname } = await import("node:path");

    // Security: validate file extension
    const ext = extname(file_path).toLowerCase();
    if (ext !== ".html" && ext !== ".htm") {
      return { content: [{ type: "text" as const, text: "Error: Only .html and .htm files are accepted." }], isError: true };
    }

    // Security: resolve to absolute path and reject path traversal
    const resolved = resolve(file_path);
    if (resolved.includes("..") || file_path.includes("\0")) {
      return { content: [{ type: "text" as const, text: "Error: Invalid file path." }], isError: true };
    }

    // Security: check file size before reading (max 10MB)
    const { stat } = await import("node:fs/promises");
    try {
      const fileStat = await stat(resolved);
      if (fileStat.size > 10 * 1024 * 1024) {
        return { content: [{ type: "text" as const, text: "Error: File too large (max 10MB)." }], isError: true };
      }
    } catch {
      return { content: [{ type: "text" as const, text: `Error: Cannot read file: ${file_path}` }], isError: true };
    }

    let html: string;
    try {
      html = await readFile(resolved, "utf-8");
    } catch {
      return { content: [{ type: "text" as const, text: `Error: Cannot read file: ${file_path}` }], isError: true };
    }
    const memos = parseFlomoHtml(html);
    if (memos.length === 0) {
      return { content: [{ type: "text" as const, text: "No memos found. Expected flomo export HTML format." }], isError: true };
    }
    const summary = memos.map((m, i) =>
      `[${i + 1}] ${m.timestamp} | ${m.title} | tags: ${m.tags.join(", ") || "none"}`
    ).join("\n");
    const text = `Found ${memos.length} memos:\n\n${summary}\n\nUse memex_write to create curated cards from these memos. Consider:\n- Grouping related memos into single cards\n- Rewriting as atomic Zettelkasten insights\n- Adding [[wikilinks]] to existing cards\n- Using source: flomo in frontmatter`;
    return { content: [{ type: "text" as const, text }] };
  });

}
