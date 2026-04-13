---
name: memex-retro
description: Save insights from completed tasks to Zettelkasten memory.
whenToUse: After completing any task involving code changes, architectural decisions, debugging, or non-trivial problem solving. Distill what you learned into atomic memory cards so future sessions can benefit. Invoke proactively at task end — do not wait for the user to ask.
---

# Memory Retro

You have access to a Zettelkasten memory system via the `memex` CLI. After completing this task, reflect on what you learned and save valuable insights.

## Tools Available

Two equivalent interfaces exist — use whichever your environment supports:

| CLI (Claude Code with memex in PATH) | MCP tool (VSCode / Cursor / any MCP client) |
|---------------------------------------|----------------------------------------------|
| `memex search <query>`               | `memex_search` with query arg                |
| `memex read <slug>`                   | `memex_read` with slug arg                   |
| `memex write <slug>`                  | `memex_write` with slug arg and body         |

The rest of this skill uses CLI syntax for brevity. Substitute MCP tool calls if CLI is unavailable.

## Process

```dot
digraph retro {
    "Task completed" -> "Distill: what insights came from this task?";
    "Distill: what insights came from this task?" -> "Any insights worth keeping?" [shape=diamond];
    "Any insights worth keeping?" -> "Done, no card written" [label="no"];
    "Any insights worth keeping?" -> "For each insight: draft atomic card" [label="yes"];
    "For each insight: draft atomic card" -> "memex search for related existing cards";
    "memex search for related existing cards" -> "memex read candidates";
    "memex read candidates" -> "Existing card covers same insight?" [shape=diamond];
    "Existing card covers same insight?" -> "Update existing card (append new info)" [label="yes"];
    "Existing card covers same insight?" -> "Write new card with [[links]]" [label="no"];
    "Update existing card (append new info)" -> "memex write <existing-card>";
    "Write new card with [[links]]" -> "memex write <new-card>";
    "memex write <existing-card>" -> "More insights?" [shape=diamond];
    "memex write <new-card>" -> "More insights?" [shape=diamond];
    "More insights?" -> "For each insight: draft atomic card" [label="yes"];
    "More insights?" -> "Done" [label="no"];
}
```

1. Ask yourself: what did I learn from this task that would be useful in the future?
2. If nothing worth remembering, skip — not every task produces insights
3. For each insight, draft an **atomic card** (one insight per card)
4. Before writing, `memex search` for related existing cards
5. **Dedup check**: If an existing card already covers this insight, `memex read` it, then update it by appending new information (use `memex write` with the full updated content)
6. If it's genuinely new, write a new card with `[[links]]` to related cards in the prose

## Card Format

```markdown
---
title: <descriptive title>
created: <today's date YYYY-MM-DD>
source: <auto-filled by client>
category: <optional category>
---

<One atomic insight, written in your own words.>

<Natural language sentences with [[links]] to related cards, explaining WHY they're related.>
```

Note: You do NOT need to include `modified` — the CLI auto-sets it on write.

## Rules

- **Atomic**: One insight per card. If you have 3 insights, write 3 cards.
- **Own words**: Don't copy-paste. Distill and rephrase — this is the Feynman method.
- **Link in context**: `[[links]]` must be embedded in sentences that explain the relationship.
  - Good: "This contradicts what we found in [[jwt-migration]] — stateless tokens can't be revoked."
  - Bad: "Related: [[jwt-migration]]"
- **Slug**: English kebab-case, descriptive. e.g., `jwt-revocation-blacklist-pattern`
- **Don't over-record**: Only save insights that would change how you approach a similar task in the future.
- **Preserve frontmatter on update**: When updating an existing card, preserve its original frontmatter fields (title, created). Only append to the body. `source` is auto-managed by the MCP server.

## External Source Cards (Flomo, etc.)

When curating cards from external sources like flomo:

- Use `source: flomo` (not `source: retro`). This is critical for anti-loopback guards.
- **Digest, don't copy.** Read the raw memo, extract the genuine insight, rewrite as atomic Zettelkasten card.
- Merge multiple related memos into one card when they're about the same topic.
- Skip low-quality fragments — the bar for external imports is higher than session retro.
- These cards follow the same quality rules above (atomic, own words, linked).
