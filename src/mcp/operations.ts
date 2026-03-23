import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { HookRegistry } from "../lib/hooks.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { stringifyFrontmatter } from "../lib/parser.js";
import { GitAdapter, readSyncConfig } from "../lib/sync.js";
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
    }),
  }, async ({ query }) => {
    await hooks.run("pre", "recall");

    if (query) {
      const result = await searchCommand(store, query, { limit: 10 });
      return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
    }

    // Try index first, fall back to card list
    const indexResult = await readCommand(store, "index");
    if (indexResult.success) {
      return { content: [{ type: "text" as const, text: indexResult.content! }] };
    }

    const listResult = await searchCommand(store, undefined, {});
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
    description: "Analyze the card network for maintenance. Returns link stats, orphans (unlinked cards), and hubs (heavily linked cards). Call this periodically (e.g. every few sessions) to identify cards that need linking or cleanup.",
    inputSchema: z.object({}),
  }, async () => {
    await hooks.run("pre", "organize");

    const result = await linksCommand(store, undefined);

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

}
