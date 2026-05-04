import matter from "gray-matter";

export interface ParsedCard {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedCard {
  try {
    const { data, content } = matter(raw);
    return { data, content };
  } catch {
    // Frontmatter parse failed (e.g. YAML special chars like # in values).
    // Fall back: treat entire file as content with empty metadata.
    const stripped = raw.replace(/^---[\s\S]*?---\n?/, "");
    return { data: {}, content: stripped || raw };
  }
}

export function stringifyFrontmatter(
  content: string,
  data: Record<string, unknown>
): string {
  // Build YAML manually to avoid gray-matter/js-yaml block scalars (>-)
  // which break simple frontmatter parsers
  const yamlLines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const str = String(value).replace(/\n/g, " ").trim();
    if (str === "" || /[:#{}[\],&*?|>!%@`']/.test(str)) {
      yamlLines.push(`${key}: '${str.replace(/'/g, "''")}'`);
    } else {
      yamlLines.push(`${key}: ${str}`);
    }
  }
  return `---\n${yamlLines.join("\n")}\n---\n${content}`;
}

export function extractLinks(body: string): string[] {
  // Strip fenced code blocks and inline code to avoid false positives
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]+`/g, "");

  const re = /\[\[([^\]]+)\]\]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    // Support Obsidian-style pipe aliases: [[target|display text]] → target
    const target = match[1].split("|")[0].trim();
    if (target) {
      links.add(target);
    }
  }
  return [...links];
}
