import { createServer } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { exec } from "node:child_process";
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedHTML: string | null = null;

async function getHTML(): Promise<string> {
  if (!cachedHTML) {
    cachedHTML = await readFile(join(__dirname, "serve-ui.html"), "utf-8");
  }
  return cachedHTML;
}

export async function serveCommand(port: number): Promise<void> {
  const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
  const store = new CardStore(join(home, "cards"), join(home, "archive"));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/api/cards") {
        const cards = await store.scanAll();
        const result = await Promise.all(
          cards.map(async (c) => {
            const raw = await store.readCard(c.slug);
            const { data, content } = parseFrontmatter(raw);
            const links = extractLinks(content);
            const firstLine = content.trim().split("\n")[0]?.trim() || "";
            return {
              slug: c.slug,
              title: String(data.title || c.slug),
              created: String(data.created || ""),
              modified: String(data.modified || ""),
              source: String(data.source || ""),
              firstLine,
              links,
            };
          })
        );
        // Index card always first, then by date descending
        result.sort((a, b) => {
          if (a.slug === "index") return -1;
          if (b.slug === "index") return 1;
          return b.created.localeCompare(a.created);
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (url.pathname.startsWith("/api/cards/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/cards/".length));
        try {
          const raw = await store.readCard(slug);
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(raw);
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
        return;
      }

      if (url.pathname === "/api/links") {
        const cards = await store.scanAll();
        const outMap = new Map<string, string[]>();
        const inMap = new Map<string, string[]>();
        for (const c of cards) inMap.set(c.slug, []);
        for (const c of cards) {
          const raw = await store.readCard(c.slug);
          const { content } = parseFrontmatter(raw);
          const links = extractLinks(content);
          outMap.set(c.slug, links);
          for (const l of links) {
            const arr = inMap.get(l) || [];
            arr.push(c.slug);
            inMap.set(l, arr);
          }
        }
        const stats = cards.map((c) => ({
          slug: c.slug,
          outbound: (outMap.get(c.slug) || []).length,
          inbound: (inMap.get(c.slug) || []).length,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats));
        return;
      }

      if (url.pathname === "/api/search") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const cards = await store.scanAll();
        const results = [];
        for (const c of cards) {
          const raw = await store.readCard(c.slug);
          const { data, content } = parseFrontmatter(raw);
          const title = String(data.title || c.slug);
          if (
            title.toLowerCase().includes(q) ||
            content.toLowerCase().includes(q)
          ) {
            const links = extractLinks(content);
            const firstLine = content.trim().split("\n")[0]?.trim() || "";
            results.push({
              slug: c.slug,
              title,
              created: String(data.created || ""),
              modified: String(data.modified || ""),
              source: String(data.source || ""),
              firstLine,
              links,
            });
          }
        }
        results.sort((a, b) => b.created.localeCompare(a.created));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(results));
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await getHTML();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      console.error("Server error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`memex is running at ${url}`);
    // Auto-open browser (skip in test/CI environments)
    if (!process.env.MEMEX_NO_OPEN) {
      const cmd = process.platform === 'darwin' ? `open ${url}`
        : process.platform === 'win32' ? `start ${url}`
        : `xdg-open ${url}`;
      exec(cmd);
    }
  });
}
