---
name: memex-organize
description: Periodic maintenance of the Zettelkasten card network.
whenToUse: When the user asks to organize, maintain, or clean up their memory cards. Also when running scheduled maintenance to detect orphans, hubs, contradictions, and rebuild the keyword index.
---

# Memory Organize

You are maintaining a Zettelkasten memory system. Your job is to keep the card network healthy.

## Tools Available

Three equivalent interfaces — use whichever your environment supports:

| CLI (memex in PATH) | Plugin CLI fallback (Claude Code) | MCP tool (VSCode / Cursor) |
|----------------------|-----------------------------------|----------------------------|
| `memex search [q]`  | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js search [q]` | `memex_search` with optional query arg |
| `memex read <slug>`  | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js read <slug>` | `memex_read` with slug arg |
| `memex write <slug>` | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js write <slug>` | `memex_write` with slug arg and body |
| `memex links`        | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js links` | `memex_links` with no args |
| `memex links <slug>` | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js links <slug>` | `memex_links` with slug arg |
| `memex archive <slug>` | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js archive <slug>` | `memex_archive` with slug arg |

**Resolution order:** Try `memex` in PATH first. If not found, define a shell function and use it:

```bash
memex() { node $HOME/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js "$@"; }
```

If both CLI approaches fail, use MCP tools.

The rest of this skill uses `memex` CLI syntax for brevity.

The rest of this skill uses CLI syntax for brevity. Substitute MCP tool calls if CLI is unavailable.

## Process

```dot
digraph organize {
    "Organize report" -> "Detect orphans (in=0)";
    "Detect orphans (in=0)" -> "For each orphan: memex read + search related";
    "For each orphan: memex read + search related" -> "LLM decides: append links / mark stale / leave alone";
    "Organize report" -> "Detect hubs (in >= 10)";
    "Detect hubs (in >= 10)" -> "LLM decides: split into smaller cards or leave alone";
    "Organize report" -> "Recently modified pairs";
    "Recently modified pairs" -> "Genuinely contradicts?" [shape=diamond];
    "Genuinely contradicts?" -> "Mark status: conflict, surface to human" [label="yes"];
    "Genuinely contradicts?" -> "Evolution?" [label="no"];
    "Evolution?" -> "Merge + archive old card" [label="yes"];
    "Evolution?" -> "Leave alone" [label="no"];
    "Organize report" -> "Resolve existing conflicts";
    "Resolve existing conflicts" -> "Ask user which belief wins";
    "All checks done" -> "Rebuild keyword index";
}
```

1. Run `memex links` to get global link graph stats
2. **Orphan detection**: For cards with 0 inbound links:
   - `memex read` the orphan
   - `memex search` for potentially related cards
   - Decide: append a link from a related card to this orphan, or leave alone if truly standalone
3. **Hub detection**: For cards with >= 10 inbound links:
   - `memex read` the hub and its linkers
   - Decide: is this card too broad? Should it be split into smaller atomic concepts?
4. **Contradiction/staleness detection**: The organize report includes recently modified cards paired with their neighbors. For each pair:
   - Read both cards' content (excerpts are in the report, `memex read` for full content if needed)
   - Determine: do these cards **genuinely contradict** each other, or is one simply an **evolution** of the other?
   - **If evolution** (new info supersedes old): merge the cards — append the old card's unique content to the new one, then `memex archive` the old card
   - **If genuine contradiction** (two conflicting beliefs, unclear which is correct): mark the newer card with `status: conflict` in frontmatter and add a note explaining the contradiction. Do NOT auto-resolve — the human decides which belief wins
   - **If no conflict**: leave both cards alone
5. **Resolve existing conflicts**: Check the "Unresolved Conflicts" section. For each card with `status: conflict`:
   - Surface it to the user: "Card X conflicts with card Y — which perspective should we keep?"
   - If the user resolves it, remove `status: conflict` from frontmatter and merge/archive as directed
6. **Rebuild keyword index** (always, as last step)

## Keyword Index Maintenance

The keyword index (`index` card) is a curated concept → card mapping, inspired by Luhmann's Schlagwortregister. It is the primary entry point for the recall skill.

After completing all checks, rebuild the index:

1. `memex search` (no args) to get all card slugs and titles
2. `memex read` each card (or at least new/modified ones)
3. Group cards by concept/topic — use your judgment to create meaningful categories
4. Write the index card:

```markdown
---
title: Keyword Index
created: <original creation date>
source: organize
---

## <Concept Category 1>
- [[slug-a]] — one-line description
- [[slug-b]] — one-line description

## <Concept Category 2>
- [[slug-c]] — one-line description
```

Rules for the index:
- Each card should appear under 1-2 categories (not more)
- Categories should be meaningful concepts, not arbitrary groupings
- Descriptions should be one line, explaining what the card is about (not just the title)
- Archived cards must be removed from the index
- New cards must be added

Use `memex write index` to save the index.

## Incremental Strategy

1. Read last run date: `cat ~/.memex/.last-organize 2>/dev/null`
2. If the file exists, only process cards where frontmatter `modified` >= that date, plus their linked neighbors
3. If the file doesn't exist, this is the first run — process all cards
4. After completing all checks, write today's date: `echo "YYYY-MM-DD" > ~/.memex/.last-organize` (use actual date)

When the organize skill creates new cards (e.g., splitting hubs), use `source: organize` in the frontmatter.

## Operation Rules

- **Append only**: When adding links to existing cards, append to the end of the body. Never modify existing prose.
- **Merge**: Read both cards, append source content to target card via `memex write`, then `memex archive` the source.
- **Archive**: Use `memex archive <slug>` to move stale cards out of active search.
- **Be conservative**: When in doubt, leave cards alone. It's better to under-organize than to break useful connections.
