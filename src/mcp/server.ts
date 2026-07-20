import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardStore } from "../lib/store.js";
import { searchCommand } from "../commands/search.js";
import { readCommand } from "../commands/read.js";
import { writeCommand } from "../commands/write.js";
import { linksCommand } from "../commands/links.js";
import { archiveCommand } from "../commands/archive.js";
import { linkCommand } from "../commands/link.js";
import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { readConfig } from "../lib/config.js";
import { HookRegistry } from "../lib/hooks.js";
import { autoFetch, autoSync } from "../lib/sync.js";
import { registerOperations } from "./operations.js";
import { formatWarnings } from "../lib/sensitive-input.js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = readPackageJson(__dirname);

function readPackageJson(startDir: string): { version: string } {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth++) {
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      const pkg = JSON.parse(readFileSync(path, "utf-8"));
      if (pkg.name === "@touchskyer/memex") return pkg;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { version: "0.0.0" };
}

export function createMemexServer(store: CardStore, home?: string): McpServer {
  const server = new McpServer({
    name: "memex",
    version: pkg.version,
  });

  // Capture client name from MCP initialize handshake
  let clientName = "mcp";
  const origConnect = server.connect.bind(server);
  server.connect = async (transport) => {
    // Listen for messages to capture client info
    const origOnMessage = transport.onmessage;
    transport.onmessage = (msg: any) => {
      if (msg?.method === "initialize" && msg?.params?.clientInfo?.name) {
        clientName = msg.params.clientInfo.name.toLowerCase().replace(/\s+/g, "-");
      }
      if (origOnMessage) origOnMessage(msg);
    };
    await origConnect(transport);
    if (home) await autoFetch(home);
  };

  const MCP_MAX_RESULTS = 50;

  function textResult(text: string, isError = false) {
    return { content: [{ type: "text" as const, text }], isError };
  }

  function writeSuccess(slug: string, warnings?: string[]) {
    const warningText = warnings?.length ? `\n\n${formatWarnings(warnings)}` : "";
    return textResult(`Card '${slug}' written successfully.${warningText}`);
  }

  server.registerTool("memex_search", {
    description: "Low-level search. Prefer memex_recall for task-start workflows. Never include actual secrets, credentials, tokens, or exact secret file contents in query; use abstract descriptions instead.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search keywords (OR logic — cards matching any token are ranked by coverage). Do not include raw secrets or credential values."),
      limit: z.number().optional().describe(`Max results (default 10, max ${MCP_MAX_RESULTS})`),
      semantic: z.boolean().optional().describe("Use embedding-based semantic search"),
      list: z.boolean().optional().describe("When true with no query, list all cards instead of showing guidance"),
    }),
  }, async ({ query, limit, semantic, list }) => {
    const config = home ? await readConfig(home) : undefined;
    const clampedLimit = Math.min(limit ?? 10, MCP_MAX_RESULTS);
    const result = await searchCommand(store, query, { limit: clampedLimit, semantic, config, memexHome: home, list });
    return textResult(result.output || "No cards found.", result.exitCode !== 0);
  });

  server.registerTool("memex_read", {
    description: "Low-level read. Use after memex_recall to drill into specific cards.",
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
    description: "Low-level write. Prefer memex_retro for task-end workflows (handles frontmatter and sync automatically). Never write actual secrets, credentials, tokens, or exact secret file contents; use redacted examples instead.",
    inputSchema: z.object({
      slug: z.string().describe("Card slug in kebab-case (e.g. 'my-insight')"),
      content: z.string().describe("Full card content: YAML frontmatter + markdown body. Title must be ≤60 chars, noun phrase not full sentence. Do not include raw secrets or credential values."),
      category: z.string().optional().describe("Card category (e.g. 'frontend', 'architecture', 'devops', 'bugfix')"),
    }),
  }, async ({ slug, content, category }) => {
    // Auto-inject source (client name) if not in frontmatter
    const { data, content: body } = parseFrontmatter(content);
    if (!data.source) data.source = clientName;
    if (category && !data.category) data.category = category;
    const enrichedContent = stringifyFrontmatter(body, data);
    const result = await writeCommand(store, slug, enrichedContent);
    if (!result.success) {
      return textResult(result.error!, true);
    }

    // Trigger autoSync after successful write (mirrors memex_retro behavior)
    let syncWarning = "";
    if (home) {
      const syncResult = await autoSync(home);
      if (syncResult && !syncResult.success) {
        syncWarning = `\n\n⚠️ ${syncResult.message}`;
      }
    }

    const warningText = result.warnings?.length ? `\n\n${formatWarnings(result.warnings)}` : "";
    return textResult(`Card '${slug}' written successfully.${warningText}${syncWarning}`);
  });

  server.registerTool("memex_links", {
    description: "Low-level link stats. Prefer memex_organize for maintenance workflows.",
    inputSchema: z.object({
      slug: z.string().optional().describe("Card slug. Omit for global stats."),
    }),
  }, async ({ slug }) => {
    let opts;
    if (home) {
      const config = await readConfig(home);
      opts = { home, extraLinkDirs: config.extraLinkDirs };
    }
    const result = await linksCommand(store, slug, opts);
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

  server.registerTool("memex_link", {
    description: "Create a relationship link between two cards. Appends a contextual [[wikilink]] from the source card to the target. The context parameter must explain WHY the cards relate — bare links without explanation are rejected.",
    inputSchema: z.object({
      from: z.string().describe("Source card slug"),
      to: z.string().describe("Target card slug"),
      context: z.string().describe("Relationship explanation sentence"),
    }),
  }, async ({ from, to, context }) => {
    if (!context.trim()) {
      return textResult("relationship context is required", true);
    }
    const result = await linkCommand(store, from, to, context);
    if (!result.success) {
      return textResult(result.error!, true);
    }
    let msg = result.message!;
    if (home) {
      const syncResult = await autoSync(home);
      if (syncResult && !syncResult.success) {
        msg += `\n\n⚠️ ${syncResult.message}`;
      }
    }
    return textResult(msg);
  });

  if (home) {
    const hooks = new HookRegistry();
    hooks.on("pre:recall", () => autoFetch(home));
    hooks.on("pre:retro", () => autoFetch(home));
    hooks.on("pre:organize", () => autoFetch(home));
    hooks.on("post:retro", async () => { await autoSync(home); });
    hooks.on("post:organize", async () => { await autoSync(home); });
    registerOperations(server, store, hooks, home, () => clientName);
  }

  return server;
}
