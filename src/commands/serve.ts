import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";
import { readSyncConfig } from "../lib/sync.js";
import { resolveMemexHome } from "../lib/config.js";

function toDateString(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  // If gray-matter already stringified a Date, extract YYYY-MM-DD
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MEMRA_URL = "https://memra.vercel.app";

let cachedHTML: string | null = null;
let cachedHTMLWithBanner: string | null = null;

async function getHTML(withBanner: boolean): Promise<string> {
  if (!cachedHTML) {
    cachedHTML = await readFile(join(__dirname, "serve-ui.html"), "utf-8");
    cachedHTMLWithBanner = injectBanner(cachedHTML);
  }
  return withBanner ? cachedHTMLWithBanner! : cachedHTML;
}

function injectBanner(html: string): string {
  const banner = `
<div id="sync-banner" style="
  position:fixed;top:0;left:0;right:0;z-index:999;
  background:linear-gradient(135deg,#007aff,#5856d6);
  color:#fff;text-align:center;padding:8px 16px;
  font-size:12px;font-weight:500;font-family:-apple-system,sans-serif;
  display:flex;align-items:center;justify-content:center;gap:8px;
">
  <span>Sync your cards to access them anywhere</span>
  <code style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:4px;font-size:11px">memex sync --init</code>
  <button onclick="this.parentElement.remove()" style="
    background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;
    font-size:16px;margin-left:8px;padding:0 4px;
  ">&times;</button>
</div>
<style>#sync-banner ~ .wallpaper { top: 36px; } #sync-banner ~ .window { margin-top: 44px; height: calc(100vh - 56px); }</style>`;
  return html.replace("<body>", "<body>" + banner);
}

export async function serveCommand(port: number): Promise<Server | null> {
  const home = await resolveMemexHome();

  // Check if synced to GitHub → redirect to online
  const syncConfig = await readSyncConfig(home);
  if (syncConfig.remote) {
    console.log(`Cards synced to ${syncConfig.remote}`);
    console.log(`Opening ${MEMRA_URL}...`);
    if (!process.env.MEMEX_NO_OPEN) {
      const bin = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start"
        : "xdg-open";
      execFile(bin, [MEMRA_URL], () => {});
    }
    return null;
  }

  // No sync — serve locally with banner
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
              created: toDateString(data.created),
              modified: toDateString(data.modified),
              source: String(data.source || ""),
              category: String(data.category || ""),
              firstLine,
              links,
            };
          })
        );
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
              created: toDateString(data.created),
              modified: toDateString(data.modified),
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

      if (url.pathname === "/share-card.js") {
        const js = await readFile(join(__dirname, "..", "share-card", "share-card.js"), "utf-8");
        const stripped = js.replace(/^export /gm, "");
        const wrapped = `(function(){\n${stripped}\nwindow.createShareCard = createShareCard;\n})();`;
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(wrapped);
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await getHTML(true);
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

  return new Promise<Server>((resolvePromise, rejectPromise) => {
    const maxRetries = 10;

    const tryListen = (currentPort: number, attempt: number): void => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          console.log(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
          tryListen(currentPort + 1, attempt + 1);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          rejectPromise(err);
        }
      });

      server.listen(currentPort, '127.0.0.1', () => {
        const url = `http://localhost:${currentPort}`;
        console.log(`memex is running at ${url}`);
        console.log("💡 Tip: Run 'memex sync --init' to sync and access your cards online");
        if (!process.env.MEMEX_NO_OPEN) {
          const bin = process.platform === "darwin" ? "open"
            : process.platform === "win32" ? "start"
            : "xdg-open";
          execFile(bin, [url], () => {});
        }
        resolvePromise(server);
      });
    };

    tryListen(port, 0);
  });
}
