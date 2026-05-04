/**
 * Memex Extension for Pi
 *
 * Persistent Zettelkasten memory for AI coding agents.
 * Wraps the `memex` CLI as Pi custom tools so the LLM can recall prior knowledge
 * at task start and save insights at task end.
 *
 * Prerequisites: npm install -g @touchskyer/memex
 *
 * Tools registered:
 *   memex_recall  – retrieve memory index or search (call at task start)
 *   memex_retro   – save an atomic insight card (call at task end)
 *   memex_search  – full-text search cards
 *   memex_read    – read a specific card by slug
 *   memex_write   – write/update a card
 *   memex_links   – show link graph stats
 *   memex_archive – archive a card
 *   memex_organize – analyze card network health
 *
 * Session lifecycle:
 *   before_agent_start  – injects recall reminder on first turn
 *   agent_end           – injects retro reminder if not yet done
 *   session_compact     – resets recall state so reminder re-injects post-compaction
 *   resources_discover  – exposes bundled skills (memex-recall, memex-retro, etc.)
 *
 * Commands:
 *   /memex         – show memex status and card count
 *   /memex-serve   – open visual timeline UI
 *   /memex-sync    – sync cards via git
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(baseDir, "..", "skills");

/** Run a memex CLI command and return stdout. Uses spawn to support stdin. */
function memex(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("memex", args, { timeout: 30_000 });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve({
          stdout: "",
          stderr:
            "memex CLI not found. Install it with: npm install -g @touchskyer/memex",
          ok: false,
        });
      } else {
        resolve({ stdout: stdout.trim(), stderr: err.message, ok: false });
      }
    });

    child.on("close", (code: number | null) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), ok: code === 0 });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function memexExtension(pi: ExtensionAPI) {
  // Track whether recall/retro have been done this session
  let recallDone = false;
  let retroDone = false;

  // -----------------------------------------------------------------------
  // Resource discovery — expose bundled skills to Pi
  // -----------------------------------------------------------------------

  pi.on("resources_discover", async () => {
    if (!existsSync(skillsDir)) return;
    return {
      skillPaths: [skillsDir],
    };
  });

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  pi.on("session_start", async (_event, _ctx) => {
    recallDone = false;
    retroDone = false;
  });

  // After compaction the recall reminder message is summarized away.
  // Reset recallDone so before_agent_start re-injects the reminder on
  // the next user prompt.
  pi.on("session_compact", async (_event, _ctx) => {
    recallDone = false;
  });

  // Inject recall reminder at the start of each agent turn (until recall is done)
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (recallDone) return;

    return {
      message: {
        customType: "memex-recall-reminder",
        content: [
          "## Memex Memory System Active",
          "",
          "You have a Zettelkasten memory system available via the `memex_recall` tool.",
          "**BEFORE starting work**, call `memex_recall` (with no query) to load your keyword index.",
          "Then read relevant cards with `memex_read` and search with `memex_search`.",
          "",
          "**AFTER completing the task**, if you learned something non-obvious,",
          "call `memex_retro` to save atomic insight cards for future sessions.",
          "",
          "Memory recall guardrails: max 3 link hops, max 20 cards read.",
        ].join("\n"),
        display: false,
      },
    };
  });

  // After each agent response, remind the LLM to call memex_retro if it
  // hasn't done so yet. Uses "nextTurn" delivery so it doesn't interrupt
  // the current response — the reminder appears on the next user prompt.
  pi.on("agent_end", async (_event, _ctx) => {
    if (retroDone || !recallDone) return;

    pi.sendMessage(
      {
        customType: "memex-retro-reminder",
        content: [
          "**Memex reminder:** If you learned something non-obvious in this task,",
          "call `memex_retro` to save an atomic insight card before finishing.",
        ].join(" "),
        display: false,
      },
      {
        deliverAs: "nextTurn",
      },
    );
  });

  // -----------------------------------------------------------------------
  // Tool: memex_recall
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_recall",
    label: "Memex Recall",
    description:
      "IMPORTANT: Call at the START of every task. Retrieves your persistent Zettelkasten memory — knowledge cards from previous sessions. Returns the keyword index (if exists) or card list. Optionally search by query.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: "Optional search query to find specific cards",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      recallDone = true;
      const { query } = params as { query?: string };

      if (query) {
        const res = await memex(["search", query, "--limit", "10"]);
        if (!res.ok) return textResult(res.stderr, true);
        return textResult(res.stdout || "No cards found.");
      }

      // Try index first, then fall back to listing all cards
      const indexRes = await memex(["read", "index"]);
      if (indexRes.ok && indexRes.stdout) {
        return textResult(indexRes.stdout);
      }

      const listRes = await memex(["search"]);
      if (!listRes.ok) return textResult(listRes.stderr, true);
      return textResult(
        listRes.stdout || "No cards yet. This is a fresh memory.",
      );
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_retro
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_retro",
    label: "Memex Retro",
    description:
      "IMPORTANT: Call at the END of every task to save what you learned. Write one atomic insight per card with [[wikilinks]] to related cards. Only save non-obvious learnings. Handles frontmatter automatically.",
    parameters: Type.Object({
      slug: Type.String({
        description:
          "Card slug in kebab-case (e.g. 'jwt-revocation-pattern')",
      }),
      title: Type.String({
        description: "Card title (≤60 chars, noun phrase not sentence)",
      }),
      body: Type.String({
        description:
          "Card body in markdown with [[wikilinks]] explaining relationships",
      }),
      category: Type.Optional(
        Type.String({
          description:
            "Category (e.g. frontend, architecture, devops, bugfix)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { slug, title, body, category } = params as {
        slug: string;
        title: string;
        body: string;
        category?: string;
      };

      const today = new Date().toISOString().split("T")[0];
      const frontmatter: Record<string, string> = {
        title,
        created: today,
        source: "pi",
      };
      if (category) frontmatter.category = category;

      const yaml = Object.entries(frontmatter)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      const content = `---\n${yaml}\n---\n\n${body}`;

      const res = await memex(["write", slug], content);
      if (!res.ok) return textResult(res.stderr, true);
      retroDone = true;
      return textResult(`Card '${slug}' saved successfully.`);
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_search
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_search",
    label: "Memex Search",
    description:
      "Full-text search memory cards. Omit query to list all cards.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Search keyword" })),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 10)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { query, limit } = params as { query?: string; limit?: number };
      const args = ["search"];
      if (query) args.push(query);
      if (limit) args.push("--limit", String(limit));

      const res = await memex(args);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(res.stdout || "No cards found.");
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_read
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_read",
    label: "Memex Read",
    description: "Read a specific memory card by its slug.",
    parameters: Type.Object({
      slug: Type.String({ description: "Card slug (e.g. 'my-card-name')" }),
    }),
    async execute(_toolCallId, params) {
      const { slug } = params as { slug: string };
      const res = await memex(["read", slug]);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(res.stdout);
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_write
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_write",
    label: "Memex Write",
    description:
      "Write or update a memory card. Content should include YAML frontmatter + markdown body.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Card slug in kebab-case",
      }),
      content: Type.String({
        description:
          "Full card content: YAML frontmatter (---) + markdown body with [[wikilinks]]",
      }),
    }),
    async execute(_toolCallId, params) {
      const { slug, content } = params as { slug: string; content: string };
      const res = await memex(["write", slug], content);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(`Card '${slug}' written successfully.`);
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_links
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_links",
    label: "Memex Links",
    description:
      "Show link graph stats. Omit slug for global stats, or specify a slug for that card's links.",
    parameters: Type.Object({
      slug: Type.Optional(
        Type.String({
          description: "Card slug (omit for global stats)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { slug } = params as { slug?: string };
      const args = ["links"];
      if (slug) args.push(slug);

      const res = await memex(args);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(res.stdout || "No link data.");
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_archive
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_archive",
    label: "Memex Archive",
    description:
      "Archive a card (move to archive). Use for outdated or superseded cards.",
    parameters: Type.Object({
      slug: Type.String({ description: "Card slug to archive" }),
    }),
    async execute(_toolCallId, params) {
      const { slug } = params as { slug: string };
      const res = await memex(["archive", slug]);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(`Card '${slug}' archived.`);
    },
  });

  // -----------------------------------------------------------------------
  // Tool: memex_organize
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "memex_organize",
    label: "Memex Organize",
    description:
      "Analyze the card network health: orphans, hubs, unresolved links, and contradictions. Call periodically.",
    parameters: Type.Object({
      since: Type.Optional(
        Type.String({
          description:
            "Only check cards modified since this date (YYYY-MM-DD). Omit for full scan.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { since } = params as { since?: string };
      const args = ["organize"];
      if (since) args.push("--since", since);

      const res = await memex(args);
      if (!res.ok) return textResult(res.stderr, true);
      return textResult(res.stdout || "No cards found.");
    },
  });

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  pi.registerCommand("memex", {
    description: "Show memex status and card count",
    handler: async (_args, ctx) => {
      const res = await memex(["search"]);
      if (!res.ok) {
        ctx.ui.notify(
          "Memex CLI not found. Run: npm install -g @touchskyer/memex",
          "error",
        );
        return;
      }
      const lines = res.stdout.split("\n").filter((l) => l.trim());
      ctx.ui.notify(`Memex: ${lines.length} cards found`, "info");
    },
  });

  pi.registerCommand("memex-serve", {
    description: "Open memex visual timeline UI",
    handler: async (_args, ctx) => {
      const res = await memex(["serve"]);
      if (!res.ok) {
        ctx.ui.notify(res.stderr || "Failed to start memex serve", "error");
        return;
      }
      ctx.ui.notify("Memex timeline opened at localhost:3939", "info");
    },
  });

  pi.registerCommand("memex-sync", {
    description: "Sync memex cards via git",
    handler: async (_args, ctx) => {
      const res = await memex(["sync"]);
      if (!res.ok) {
        ctx.ui.notify(res.stderr || "Sync failed", "error");
        return;
      }
      ctx.ui.notify(res.stdout || "Memex cards synced", "success");
    },
  });
}
