import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AGENTS_SECTION = `## Memory (memex)

You have access to memex tools for persistent Zettelkasten memory.

### Task start (recall)
- Call memex_search to check for relevant prior knowledge
- Call memex_read on matching cards to get full context
- Follow [[wikilinks]] in card content to traverse related knowledge

### Task end (retro)
- Reflect: did you learn something non-obvious worth remembering?
- Call memex_search to check for duplicates before writing
- Call memex_write to save atomic cards with [[links]] to related cards
- Card format: YAML frontmatter (title, created, source) + markdown body
- Slugs: English kebab-case. Write card content in user's language.

### Sync
- Call memex_sync after writing cards to sync across devices
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

  if (existing.includes("## Memory (memex)")) {
    return { success: true, output: "AGENTS.md already has memex section. No changes made." };
  }

  const content = existing
    ? existing.trimEnd() + "\n\n" + AGENTS_SECTION
    : AGENTS_SECTION;

  await writeFile(filePath, content, "utf-8");

  return {
    success: true,
    output: existing
      ? "Appended memex section to AGENTS.md."
      : "Created AGENTS.md with memex section.",
  };
}
