import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { archiveCommand } from "../commands/archive.js";
import { syncCommand } from "../commands/sync.js";
import { z } from "zod";

export function createMemexServer(store: CardStore, home?: string): McpServer {
  const server = new McpServer({
    name: "memex",
    version: "0.1.2",
  });

  server.registerTool("memex_search", {
    description: "Search Zettelkasten memory cards by keyword, or list all cards if no query. Use at the start of a task to recall relevant prior knowledge. Follow [[wikilinks]] in results by calling memex_read.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search keyword. Omit to list all cards."),
      limit: z.number().optional().describe("Max results (default 10)"),
    }),
  }, async ({ query, limit }) => {
    const result = await searchCommand(store, query, { limit });
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_read", {
    description: "Read a card's full content including frontmatter and body. Use after memex_search to get full context. Follow [[wikilinks]] to traverse related knowledge.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug (e.g. 'my-card-name')"),
    }),
  }, async ({ slug }) => {
    const result = await readCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: result.content! }] };
  });

  server.registerTool("memex_write", {
    description: "Write or update a Zettelkasten card. Use after completing a task to save non-obvious insights. Content must include YAML frontmatter with title, created, and source fields, followed by markdown body with [[wikilinks]].",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case (e.g. 'my-insight')"),
      content: z.string().describe("Full card content: YAML frontmatter + markdown body"),
    }),
  }, async ({ slug, content }) => {
    const result = await writeCommand(store, slug, content);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' written successfully.` }] };
  });

  server.registerTool("memex_links", {
    description: "Show link graph statistics for all cards, or inbound/outbound links for a specific card. Useful for understanding card connectivity and finding orphans.",
    inputSchema: z.object({
      slug: z.string().optional().describe("Card slug. Omit for global stats."),
    }),
  }, async ({ slug }) => {
    const result = await linksCommand(store, slug);
    return { content: [{ type: "text" as const, text: result.output || "No cards found." }] };
  });

  server.registerTool("memex_archive", {
    description: "Move a card to the archive. Use for outdated or superseded cards.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug to archive"),
    }),
  }, async ({ slug }) => {
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error! }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Card '${slug}' archived.` }] };
  });

  if (home) {
    server.registerTool("memex_sync", {
      description: "Sync memory cards across devices via git. Call after writing cards to keep them in sync. Use action 'status' to check sync state, 'auto_on'/'auto_off' to toggle auto-sync.",
      inputSchema: z.object({
        action: z.enum(["sync", "status", "auto_on", "auto_off"]).optional().describe("Action to perform (default: sync)"),
      }),
    }, async ({ action }) => {
      const a = action || "sync";
      const opts = {
        status: a === "status",
        auto: a === "auto_on" ? "on" : a === "auto_off" ? "off" : undefined,
      };
      const result = await syncCommand(home, opts);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: result.error! }], isError: true };
      }
      return { content: [{ type: "text" as const, text: result.output || "Synced." }] };
    });
  }

  return server;
}
