import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AGENTS_SECTION = `## Memory (memex)

This project uses memex for persistent agent memory across sessions.

### Workflow
- **Task start**: Call \`memex_recall\` to retrieve relevant prior knowledge before starting work
- **Task end**: Call \`memex_retro\` to save non-obvious insights as atomic cards with [[wikilinks]]
- **Periodically**: Call \`memex_organize\` to review link stats and maintain the knowledge graph

### Available MCP tools
| Tool | Purpose |
|------|---------|
| \`memex_recall\` | Recall relevant cards (reads index or searches by query) |
| \`memex_retro\` | Save an insight card (auto-generates frontmatter and syncs) |
| \`memex_search\` | Search cards by keyword |
| \`memex_read\` | Read a specific card by slug |
| \`memex_write\` | Low-level write (prefer memex_retro) |
| \`memex_organize\` | Analyze link graph for orphans and hubs |
| \`memex_pull\` | Pull latest cards from remote |
| \`memex_push\` | Push local cards to remote |

### Cross-device sync
To sync cards across devices, run in terminal:
\`\`\`
memex sync --init git@github.com:<you>/memex-cards.git
memex sync on
\`\`\`
Do NOT manually git init in ~/.memex — always use \`memex sync\` commands.
`;

interface InitResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function initCommand(dir: string): Promise<InitResult> {
  const filePath = join(dir, "AGENTS.md");

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // file doesn't exist, will create
  }

  // Replace old memex section if present, otherwise append
  const memexHeader = "## Memory (memex)";
  let content: string;
  let action: string;

  if (existing.includes(memexHeader)) {
    // Find the memex section and replace it (up to next ## or end of file)
    const start = existing.indexOf(memexHeader);
    const afterStart = existing.indexOf("\n## ", start + memexHeader.length);
    const before = existing.slice(0, start).trimEnd();
    const after = afterStart >= 0 ? existing.slice(afterStart) : "";
    content = (before ? before + "\n\n" : "") + AGENTS_SECTION + (after ? "\n" + after : "");
    action = "Updated memex section in AGENTS.md.";
  } else if (existing) {
    content = existing.trimEnd() + "\n\n" + AGENTS_SECTION;
    action = "Appended memex section to AGENTS.md.";
  } else {
    content = AGENTS_SECTION;
    action = "Created AGENTS.md with memex section.";
  }

  await writeFile(filePath, content, "utf-8");

  return {
    success: true,
    output: action
      + "\n\nTip: To sync cards across devices, run: memex sync --init <your-git-remote>",
  };
}
