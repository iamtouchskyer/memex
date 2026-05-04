import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Importer, ImportOptions, ImportResult } from "./index.js";

export interface Section {
  title: string;
  body: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function extractH2Sections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

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

export function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function yamlEscape(str: string): string {
  if (/[:#\[\]{}&*!|>'"%@`\uff1a]/.test(str) || str.trim() !== str) {
    return JSON.stringify(str);
  }
  return str;
}

export function buildCard(
  date: string | null,
  title: string,
  body: string,
  siblingLinks: string[]
): string {
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

export function generateSlugs(
  sections: Section[],
  date: string | null,
  fallbackName: string
): string[] {
  const seen = new Map<string, number>();
  return sections.map((s, i) => {
    let base = date
      ? `${date}-${slugify(s.title)}`
      : slugify(s.title);
    base = base || `${fallbackName}-section-${i}`;

    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count > 0 ? `${base}-${count + 1}` : base;
  });
}

export class OpenClawImporter implements Importer {
  name = "openclaw";
  description = "Import daily memory files from OpenClaw (~/.openclaw/workspace/memory/)";
  defaultSourceDir = join(".openclaw", "workspace", "memory");

  async run(opts: ImportOptions): Promise<ImportResult> {
    const { store, sourceDir, dryRun = false, onLog = console.log } = opts;

    const files = (await readdir(sourceDir))
      .filter((f: string) => f.endsWith(".md"))
      .sort();

    let created = 0;
    let skipped = 0;

    for (const file of files) {
      const content = await readFile(join(sourceDir, file), "utf-8");
      const date = extractDateFromFilename(file);
      const sections = extractH2Sections(content);

      if (sections.length === 0) {
        onLog(`  skip ${file} (no H2 sections)`);
        continue;
      }

      const slugs = generateSlugs(sections, date, basename(file, ".md"));

      for (let i = 0; i < sections.length; i++) {
        const slug = slugs[i];

        const existing = await store.resolve(slug);
        if (existing) {
          skipped++;
          continue;
        }

        const siblingLinks = slugs.filter((_: string, j: number) => j !== i);
        const cardContent = buildCard(date, sections[i].title, sections[i].body, siblingLinks);

        if (dryRun) {
          onLog(`  [dry-run] would write: ${slug}.md (${sections[i].title})`);
        } else {
          await store.writeCard(slug, cardContent);
          onLog(`  ✓ ${slug}.md`);
        }
        created++;
      }
    }

    return { created, skipped };
  }
}
