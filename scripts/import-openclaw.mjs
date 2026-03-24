#!/usr/bin/env node
/**
 * Import OpenClaw daily memory files into Memex cards.
 *
 * Each H2 section in a daily memory file becomes a separate Memex card,
 * with wikilinks connecting sections from the same day.
 *
 * Usage:
 *   node scripts/import-openclaw.mjs [--dry-run]
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCLAW_MEMORY = join(homedir(), ".openclaw", "workspace", "memory");
const MEMEX_HOME = process.env.MEMEX_HOME || join(homedir(), ".memex");
const DRY_RUN = process.argv.includes("--dry-run");

// Import CardStore from compiled dist (Windows needs pathToFileURL for ESM)
import { pathToFileURL } from "node:url";
const storeModule = await import(pathToFileURL(join(__dirname, "..", "dist", "lib", "store.js")).href);
const { CardStore } = storeModule;
const store = new CardStore(join(MEMEX_HOME, "cards"), join(MEMEX_HOME, "archive"));

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function extractH2Sections(content) {
  const lines = content.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      if (current) sections.push(current);
      current = { title: h2Match[1].trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);

  for (const s of sections) {
    s.body = s.body.trimEnd();
  }

  return sections;
}

function extractDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function yamlEscape(str) {
  if (/[:#\[\]{}&*!|>'"%@`]/.test(str) || str.trim() !== str) {
    return JSON.stringify(str);
  }
  return str;
}

function buildCard(date, title, body, siblingLinks) {
  const created = date || new Date().toISOString().slice(0, 10);
  const tags = date
    ? `[openclaw-memory, "${date}"]`
    : `[openclaw-memory]`;

  const links = siblingLinks.length > 0
    ? `\nRelated: ${siblingLinks.map(s => `[[${s}]]`).join(" ")}`
    : "";

  return `---
title: ${yamlEscape(title)}
created: "${created}"
source: openclaw
tags: ${tags}
---
${body}${links}
`;
}

async function main() {
  if (!existsSync(OPENCLAW_MEMORY)) {
    console.error(`OpenClaw memory directory not found: ${OPENCLAW_MEMORY}`);
    process.exit(1);
  }

  const files = (await readdir(OPENCLAW_MEMORY))
    .filter(f => f.endsWith(".md"))
    .sort();

  let totalCards = 0;
  let skippedCards = 0;

  for (const file of files) {
    const content = await readFile(join(OPENCLAW_MEMORY, file), "utf-8");
    const date = extractDateFromFilename(file);
    const sections = extractH2Sections(content);

    if (sections.length === 0) {
      console.log(`  skip ${file} (no H2 sections)`);
      continue;
    }

    const slugs = sections.map((s, i) => {
      const base = date
        ? `${date}-${slugify(s.title)}`
        : slugify(s.title);
      return base || `${basename(file, ".md")}-section-${i}`;
    });

    for (let i = 0; i < sections.length; i++) {
      const slug = slugs[i];

      // Check if card already exists via CardStore
      const existing = await store.resolve(slug);
      if (existing) {
        skippedCards++;
        continue;
      }

      const siblingLinks = slugs.filter((_, j) => j !== i);
      const cardContent = buildCard(date, sections[i].title, sections[i].body, siblingLinks);

      if (DRY_RUN) {
        console.log(`  [dry-run] would write: ${slug}.md (${sections[i].title})`);
      } else {
        await store.writeCard(slug, cardContent);
        console.log(`  ✓ ${slug}.md`);
      }
      totalCards++;
    }
  }

  console.log(`\nDone: ${totalCards} cards ${DRY_RUN ? "would be " : ""}created, ${skippedCards} skipped (already exist)`);
  console.log(`Cards directory: ${join(MEMEX_HOME, "cards")}`);
  if (!DRY_RUN) {
    console.log(`\nRun 'memex serve' to visualize!`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
