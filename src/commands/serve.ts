import { createServer } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";

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
        result.sort((a, b) => b.created.localeCompare(a.created));
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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getHTML());
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
    console.log(`memex is running at http://localhost:${port}`);
  });
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>memex</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --surface: rgba(255,255,255,0.72);
  --surface-2: rgba(255,255,255,0.45);
  --menubar-bg: rgba(236,236,236,0.72);
  --border: rgba(0,0,0,0.1);
  --border-strong: rgba(0,0,0,0.18);
  --label: #1d1d1f;
  --label-2: rgba(60,60,67,0.6);
  --label-3: rgba(60,60,67,0.36);
  --blue: #007aff;
  --green: #34c759;
  --purple: #af52de;
  --spring: cubic-bezier(0.34,1.2,0.64,1);
  --sidebar-w: 280px;
}

html, body {
  height: 100%;
  font-family: -apple-system, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', sans-serif;
  color: var(--label);
  -webkit-font-smoothing: antialiased;
  scrollbar-width: none;
  overflow: hidden;
}
body::-webkit-scrollbar { display: none; }
*::-webkit-scrollbar { display: none; }

/* === Wallpaper === */
.wallpaper {
  position: fixed; inset: 0; z-index: 0;
  background: linear-gradient(160deg, #b8cfe0 0%, #c5bedd 40%, #d4c5cc 70%, #c8d4c8 100%);
  background-size: 200% 200%;
  animation: wallpaperBreathe 12s ease-in-out infinite;
}
.wallpaper::after {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.25) 0%, transparent 60%),
              radial-gradient(ellipse at 80% 80%, rgba(180,160,200,0.3) 0%, transparent 50%);
  animation: glowBreathe 10s ease-in-out infinite alternate;
}
@keyframes wallpaperBreathe {
  0%   { background-position: 0% 0%; }
  25%  { background-position: 100% 20%; }
  50%  { background-position: 80% 100%; }
  75%  { background-position: 20% 80%; }
  100% { background-position: 0% 0%; }
}
@keyframes glowBreathe {
  0%   { opacity: 0.6; }
  100% { opacity: 1; }
}

/* === Top bar === */
.topbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  height: 44px;
  background: var(--menubar-bg);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-bottom: 0.5px solid var(--border);
  gap: 16px;
}

.topbar-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: var(--label);
  white-space: nowrap;
  user-select: none;
}

.search-wrap {
  flex: 1;
  max-width: 360px;
  position: relative;
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--label-3);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 12px 6px 30px;
  font-size: 12px;
  font-family: inherit;
  background: rgba(0,0,0,0.04);
  border: 0.5px solid var(--border);
  border-radius: 7px;
  outline: none;
  color: var(--label);
  transition: all 0.2s ease;
}
.search-input:focus {
  background: rgba(255,255,255,0.85);
  border-color: rgba(0,122,255,0.4);
  box-shadow: 0 0 0 3px rgba(0,122,255,0.1);
}
.search-input::placeholder {
  color: var(--label-3);
  font-size: 12px;
}

.search-kbd {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--label-3);
  background: rgba(0,0,0,0.04);
  border: 0.5px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  pointer-events: none;
  font-family: inherit;
}

/* === Layout === */
.layout {
  position: relative;
  z-index: 1;
  display: flex;
  height: calc(100vh - 44px);
  margin-top: 44px;
}

/* === Sidebar === */
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  height: 100%;
  overflow-y: auto;
  padding: 24px 20px 40px;
  border-right: 0.5px solid var(--border);
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
}

/* Stats row */
.stats-row {
  display: flex;
  justify-content: space-between;
  text-align: center;
  margin-bottom: 24px;
}
.stat-item {
  flex: 1;
}
.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--label);
  line-height: 1.1;
}
.stat-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--label-3);
  margin-top: 2px;
}

/* Heatmap */
.heatmap-wrap {
  margin-bottom: 24px;
}
.heatmap-grid {
  display: flex;
  gap: 3px;
}
.heatmap-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.heatmap-cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: rgba(0,0,0,0.04);
}
.heatmap-cell.l1 { background: rgba(52,199,89,0.25); }
.heatmap-cell.l2 { background: rgba(52,199,89,0.5); }
.heatmap-cell.l3 { background: rgba(52,199,89,0.75); }
.heatmap-cell.l4 { background: #34c759; }
.heatmap-months {
  display: flex;
  margin-top: 4px;
  font-size: 9px;
  color: var(--label-3);
  padding-left: 0;
}
.heatmap-months span {
  flex: 1;
  text-align: center;
}

/* Separator */
.sidebar-sep {
  border: none;
  border-top: 0.5px solid var(--border);
  margin: 0 0 16px;
}

/* Categories */
.cat-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--label-3);
  margin-bottom: 8px;
}
.cat-list {
  list-style: none;
}
.cat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--label);
  transition: background 0.15s ease;
  user-select: none;
  margin-bottom: 1px;
}
.cat-item:hover {
  background: rgba(0,0,0,0.04);
}
.cat-item.active {
  background: rgba(0,122,255,0.1);
  color: var(--blue);
}
.cat-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--label-3);
}
.cat-item.active .cat-count {
  color: var(--blue);
}

/* === Main content === */
.main {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  padding: 24px 32px 100px;
}

/* Date group */
.date-group {
  margin-bottom: 8px;
}
.date-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--label-3);
  margin-bottom: 10px;
  padding-left: 2px;
}

/* === Cards === */
.card {
  border-radius: 14px;
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 0.5px solid var(--border);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  padding: 14px 18px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.3s var(--spring);
  will-change: transform;
  animation: cardIn 0.3s var(--spring) both;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.08);
}
.card.expanded {
  cursor: default;
  transform: none;
}
.card.expanded:hover {
  transform: none;
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.source-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.source-badge.retro {
  background: rgba(0,122,255,0.08);
  color: #007aff;
}
.source-badge.manual {
  background: rgba(52,199,89,0.08);
  color: #34c759;
}
.source-badge.organize {
  background: rgba(175,82,222,0.08);
  color: #af52de;
}
.source-badge.default {
  background: rgba(60,60,67,0.06);
  color: var(--label-3);
}

.card-dot {
  color: var(--label-3);
  font-size: 10px;
}

.card-time {
  font-size: 10px;
  font-weight: 400;
  color: var(--label-3);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--label);
  margin-bottom: 4px;
  line-height: 1.4;
}

.card-preview {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: var(--label-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}

.card-links {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 500;
  color: var(--blue);
  background: rgba(0,122,255,0.08);
  padding: 3px 10px;
  border-radius: 20px;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s ease, transform 0.15s var(--spring);
  user-select: none;
}
.chip:hover {
  background: rgba(0,122,255,0.16);
  transform: scale(1.04);
}

.card-body {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.5s var(--spring), opacity 0.3s ease, margin 0.3s ease;
  margin-top: 0;
}
.card.expanded .card-body {
  max-height: 3000px;
  opacity: 1;
  margin-top: 12px;
}
.card.expanded .card-preview {
  display: none;
}

.card-body-inner {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: var(--label);
  border-top: 0.5px solid var(--border);
  padding-top: 12px;
}
.card-body-inner p { margin-bottom: 8px; }
.card-body-inner code {
  background: rgba(0,0,0,0.05);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Menlo', monospace;
}
.card-body-inner pre {
  background: rgba(0,0,0,0.04);
  padding: 12px 14px;
  border-radius: 10px;
  overflow-x: auto;
  margin-bottom: 8px;
  scrollbar-width: none;
  border: 0.5px solid var(--border);
}
.card-body-inner pre::-webkit-scrollbar { display: none; }
.card-body-inner pre code {
  background: none;
  padding: 0;
}
.card-body-inner strong {
  font-weight: 600;
  color: var(--label);
}

.card-highlight {
  animation: highlight-pulse 1.2s ease;
}
@keyframes highlight-pulse {
  0%   { box-shadow: 0 0 0 4px rgba(0,122,255,0.35), 0 1px 4px rgba(0,0,0,0.06); }
  100% { box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04); }
}

.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--label-3);
  font-size: 13px;
  font-weight: 500;
}

/* === Loading shimmer === */
.loading-text {
  color: var(--label-3);
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

@media (max-width: 700px) {
  .sidebar { display: none; }
  .layout { display: block; }
  .main { height: calc(100vh - 44px); padding: 16px 12px 80px; }
}
</style>
</head>
<body>

<div class="wallpaper"></div>

<div class="topbar">
  <div class="topbar-title">memex</div>
  <div class="search-wrap">
    <svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/></svg>
    <input type="text" class="search-input" placeholder="Search cards..." id="search">
    <span class="search-kbd">&#8984;K</span>
  </div>
</div>

<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="stats-row" id="stats-row">
      <div class="stat-item"><div class="stat-num" id="stat-cards">-</div><div class="stat-label">cards</div></div>
      <div class="stat-item"><div class="stat-num" id="stat-links">-</div><div class="stat-label">links</div></div>
      <div class="stat-item"><div class="stat-num" id="stat-days">-</div><div class="stat-label">days</div></div>
    </div>
    <div class="heatmap-wrap" id="heatmap"></div>
    <hr class="sidebar-sep">
    <div class="cat-title">Categories</div>
    <ul class="cat-list" id="cat-list"></ul>
  </aside>
  <div class="main" id="timeline"></div>
</div>

<script>
(function() {
  let allCards = [];
  let expandedSlug = null;
  let bodyCache = {};
  let activeCategory = null; // null = all
  let categories = []; // [{name, slugs}]

  const timeline = document.getElementById('timeline');
  const searchInput = document.getElementById('search');

  const sourceColors = { retro: 'retro', manual: 'manual', organize: 'organize' };

  // ---- Keyboard shortcut ----
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ---- Load data ----
  async function init() {
    const [cardsRes, linksRes] = await Promise.all([
      fetch('/api/cards'),
      fetch('/api/links')
    ]);
    allCards = await cardsRes.json();
    const linkStats = await linksRes.json();
    const totalLinks = linkStats.reduce((s, l) => s + l.outbound, 0);

    // Stats
    document.getElementById('stat-cards').textContent = allCards.length;
    document.getElementById('stat-links').textContent = totalLinks;
    const dates = allCards.map(c => c.created?.slice(0,10)).filter(Boolean).sort();
    if (dates.length > 0) {
      const first = new Date(dates[0]);
      const now = new Date();
      const days = Math.max(1, Math.ceil((now.getTime() - first.getTime()) / 86400000));
      document.getElementById('stat-days').textContent = days;
    } else {
      document.getElementById('stat-days').textContent = '0';
    }

    buildHeatmap();
    await loadCategories();
    renderTimeline();
  }

  // ---- Heatmap ----
  function buildHeatmap() {
    // Count activity per day from created/modified
    const counts = {};
    allCards.forEach(c => {
      [c.created, c.modified].forEach(d => {
        if (!d) return;
        const day = d.slice(0, 10);
        counts[day] = (counts[day] || 0) + 1;
      });
    });

    const today = new Date();
    // Start from 12 weeks ago, aligned to Monday
    const start = new Date(today);
    start.setDate(start.getDate() - (12 * 7 - 1));
    // Align to Monday (1=Mon)
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + mondayOffset);

    const weeks = [];
    const d = new Date(start);
    while (d <= today) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const ds = d.toISOString().slice(0, 10);
        const count = counts[ds] || 0;
        const future = d > today;
        week.push({ date: ds, count, future });
        d.setDate(d.getDate() + 1);
      }
      weeks.push(week);
    }

    // Determine max for scaling
    const maxCount = Math.max(1, ...Object.values(counts));
    function level(count) {
      if (count === 0) return '';
      const ratio = count / maxCount;
      if (ratio <= 0.25) return 'l1';
      if (ratio <= 0.5) return 'l2';
      if (ratio <= 0.75) return 'l3';
      return 'l4';
    }

    let html = '<div class="heatmap-grid">';
    weeks.forEach(week => {
      html += '<div class="heatmap-col">';
      week.forEach(cell => {
        if (cell.future) {
          html += '<div class="heatmap-cell" style="visibility:hidden"></div>';
        } else {
          const lv = level(cell.count);
          const title = cell.date + ': ' + cell.count + ' activities';
          html += '<div class="heatmap-cell ' + lv + '" title="' + title + '"></div>';
        }
      });
      html += '</div>';
    });
    html += '</div>';

    // Month labels
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const seenMonths = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const m = new Date(week[0].date).getMonth();
      if (m !== lastMonth) {
        seenMonths.push({ index: wi, label: months[m] });
        lastMonth = m;
      }
    });
    html += '<div class="heatmap-months">';
    let mi = 0;
    weeks.forEach((_, wi) => {
      if (mi < seenMonths.length && seenMonths[mi].index === wi) {
        html += '<span>' + seenMonths[mi].label + '</span>';
        mi++;
      } else {
        html += '<span></span>';
      }
    });
    html += '</div>';

    document.getElementById('heatmap').innerHTML = html;
  }

  // ---- Categories from index card ----
  async function loadCategories() {
    try {
      const res = await fetch('/api/cards/index');
      if (!res.ok) return;
      const raw = await res.text();
      // Strip frontmatter
      const content = raw.replace(/^---[\\s\\S]*?---\\n?/, '');
      const lines = content.split('\\n');
      let current = null;
      categories = [];
      lines.forEach(line => {
        const hm = line.match(/^##\\s+(.+)/);
        if (hm) {
          current = { name: hm[1].trim(), slugs: [] };
          categories.push(current);
          return;
        }
        if (current) {
          const lm = line.match(/\\[\\[([^\\]]+)\\]\\]/);
          if (lm) current.slugs.push(lm[1]);
        }
      });
    } catch(e) {}
    renderCategories();
  }

  function renderCategories() {
    const list = document.getElementById('cat-list');
    let html = '<li class="cat-item' + (activeCategory === null ? ' active' : '') + '" data-cat="__all">All cards<span class="cat-count">' + allCards.length + '</span></li>';
    categories.forEach(cat => {
      const isActive = activeCategory === cat.name;
      html += '<li class="cat-item' + (isActive ? ' active' : '') + '" data-cat="' + esc(cat.name) + '">'
        + esc(cat.name)
        + '<span class="cat-count">' + cat.slugs.length + ' cards</span>'
        + '</li>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.cat-item').forEach(el => {
      el.addEventListener('click', () => {
        const cat = el.dataset.cat;
        activeCategory = cat === '__all' ? null : cat;
        renderCategories();
        renderTimeline();
      });
    });
  }

  // ---- Filter cards ----
  function getFilteredCards() {
    let cards = allCards;
    const q = searchInput.value.toLowerCase();
    if (q) {
      cards = cards.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.firstLine.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q)
      );
    }
    if (activeCategory) {
      const cat = categories.find(c => c.name === activeCategory);
      if (cat) {
        const slugSet = new Set(cat.slugs);
        cards = cards.filter(c => slugSet.has(c.slug));
      }
    }
    return cards;
  }

  // ---- Render timeline grouped by date ----
  function renderTimeline() {
    const cards = getFilteredCards();
    if (cards.length === 0) {
      timeline.innerHTML = '<div class="empty">No cards found</div>';
      return;
    }

    // Group by date
    const groups = new Map();
    cards.forEach(c => {
      const date = c.created ? c.created.slice(0, 10) : 'Unknown';
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(c);
    });

    let html = '';
    let cardIndex = 0;
    for (const [date, groupCards] of groups) {
      html += '<div class="date-group">';
      html += '<div class="date-header">' + esc(date) + '</div>';
      groupCards.forEach(c => {
        html += cardHTML(c, cardIndex++);
      });
      html += '</div>';
    }

    timeline.innerHTML = html;
    bindCardListeners();
  }

  function cardHTML(c, index) {
    const time = c.created ? c.created.slice(11, 16) || '' : '';
    const chips = c.links.map(l =>
      '<span class="chip" data-link="' + esc(l) + '">[[' + esc(l) + ']]</span>'
    ).join('');
    const isExpanded = expandedSlug === c.slug;
    const src = (c.source || '').toLowerCase();
    const badgeClass = sourceColors[src] || 'default';
    const badgeLabel = src || 'note';
    const delay = Math.min(index * 0.03, 0.6);
    return '<div class="card' + (isExpanded ? ' expanded' : '') + '" data-slug="' + esc(c.slug) + '" id="card-' + esc(c.slug) + '" style="animation-delay:' + delay + 's">'
      + '<div class="card-header">'
      + '<span class="source-badge ' + badgeClass + '">' + esc(badgeLabel) + '</span>'
      + '<span class="card-dot">\\u00b7</span>'
      + '<span class="card-time">' + esc(time || c.created?.slice(0,10) || '') + '</span>'
      + '</div>'
      + '<div class="card-title">' + esc(c.title) + '</div>'
      + '<div class="card-preview">' + esc(c.firstLine) + '</div>'
      + (chips ? '<div class="card-links">' + chips + '</div>' : '')
      + '<div class="card-body"><div class="card-body-inner" id="body-' + esc(c.slug) + '">'
      + (isExpanded && bodyCache[c.slug] ? renderMarkdown(bodyCache[c.slug]) : '')
      + '</div></div>'
      + '</div>';
  }

  function bindCardListeners() {
    timeline.querySelectorAll('.card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.chip')) return;
        toggleCard(el, el.dataset.slug);
      });
    });
    timeline.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToCard(el.dataset.link);
      });
    });
  }

  async function toggleCard(el, slug) {
    if (el.classList.contains('expanded')) {
      el.classList.remove('expanded');
      expandedSlug = null;
      return;
    }
    const prev = timeline.querySelector('.card.expanded');
    if (prev) prev.classList.remove('expanded');

    expandedSlug = slug;
    el.classList.add('expanded');

    const bodyEl = document.getElementById('body-' + slug);
    if (!bodyCache[slug]) {
      bodyEl.innerHTML = '<span class="loading-text">Loading...</span>';
      const res = await fetch('/api/cards/' + encodeURIComponent(slug));
      const raw = await res.text();
      const stripped = raw.replace(/^---[\\s\\S]*?---\\n?/, '').trim();
      bodyCache[slug] = stripped;
    }
    bodyEl.innerHTML = renderMarkdown(bodyCache[slug]);
    bodyEl.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToCard(c.dataset.link);
      });
    });
  }

  function navigateToCard(slug) {
    const el = document.getElementById('card-' + slug);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('card-highlight');
      setTimeout(() => el.classList.remove('card-highlight'), 1300);
      if (!el.classList.contains('expanded')) {
        toggleCard(el, slug);
      }
    }
  }

  function renderMarkdown(text) {
    let html = esc(text);
    html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\[\\[([^\\]]+)\\]\\]/g, '<span class="chip" data-link="$1">[[$1]]</span>');
    html = html.split('\\n\\n').map(p => '<p>' + p + '</p>').join('');
    html = html.replace(/\\n/g, '<br>');
    return html;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Search
  searchInput.addEventListener('input', () => {
    renderTimeline();
  });

  init();
})();
</script>
</body>
</html>`;
}
