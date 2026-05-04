---
name: memex-agentic-memory
description: A-MEM-inspired agentic memory workflow for structured knowledge capture.
whenToUse: >
  When experimental.agenticMemory is enabled in .memexrc AND the agent has completed
  meaningful work that produced reusable insights. This skill provides a structured
  workflow for creating high-quality atomic memory cards with metadata enrichment,
  candidate retrieval, and deliberate link decisions. Do NOT use this skill when
  the feature flag is disabled — fall back to memex-retro instead.
---

# Agentic Memory Skill (Experimental)

An A-MEM-inspired workflow that uses existing memex primitives to produce
higher-quality memory cards through structured observation, enrichment,
retrieval, and deliberate linking.

**This skill is experimental and requires opt-in.**

## Prerequisite: Feature Flag Guard

Before proceeding, locate `.memexrc` using the same precedence as core memex:

1. `$MEMEX_HOME/.memexrc` (if `MEMEX_HOME` env var is set)
2. Walk up from the current directory looking for `.memexrc`
3. `~/.memex/.memexrc` (fallback)

Check that `experimental.agenticMemory` is exactly `true`.

**If the flag is missing, false, or not exactly `true`, STOP. Use the standard
`memex-retro` skill instead.** Do not proceed with the agentic workflow.

## Tools Available

Three equivalent interfaces — use whichever your environment supports:

| CLI (memex in PATH) | Plugin CLI fallback (Claude Code) | MCP tool (VSCode / Cursor) |
|----------------------|-----------------------------------|----------------------------|
| `memex search <q>`  | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js search <q>` | `memex_search` with query arg |
| `memex read <slug>`  | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js read <slug>` | `memex_read` with slug arg |
| `memex write <slug>` | `node ~/.claude/plugins/cache/cc-plugins/memex/*/dist/cli.js write <slug>` | `memex_write` with slug arg and body |

**Resolution order:** Try `memex` in PATH first. If not found, use the plugin
fallback or MCP tools.

## Workflow

### Step 1: Input Triage

Identify whether there is a memory-worthy insight from the completed work.

Skip if the content is:
- Temporary or session-specific (current task state, in-progress work)
- Obvious or well-known (standard library usage, common patterns)
- Not reusable across future sessions

If nothing is worth remembering, stop here.

### Step 2: Draft Atomic Card

For each insight, draft one card:

- **Title**: Short, descriptive
- **Slug**: English kebab-case (e.g., `yaml-array-roundtrip-bug`)
- **Body**: One atomic insight in your own words. Distill, don't copy.
- **Context**: Add explicit project/domain context when the insight would be
  ambiguous without it

### Step 3: Metadata Draft

Generate candidate metadata as simple string fields:

```yaml
---
title: <title>
created: <YYYY-MM-DD>
source: <client>
category: <optional>
context: <one sentence explaining domain and purpose>
keywords: <3-8 salient terms, comma-separated>
tags: <broad categories, comma-separated>
---
```

**Important**: Store `context`, `keywords`, and `tags` as comma-separated
strings, not YAML arrays. This avoids frontmatter serialization issues with
the current `stringifyFrontmatter` implementation.

### Step 4: Candidate Retrieval

Before writing, search for related existing cards.

Try semantic search first:

```bash
memex search "<topic query>" --semantic --compact --limit 8
```

If semantic search fails or is unavailable, fall back to keyword search:

```bash
memex search "<topic query>" --compact --limit 8
```

Read the top candidates that look relevant:

```bash
memex read <slug>
```

**Limits** to avoid runaway retrieval:
- Max candidate searches: 3
- Max cards read: 10
- Max link hops: 2

### Step 5: Decision

Choose exactly one primary action per insight:

| Action | When |
|--------|------|
| **create** | No existing card covers the insight. Embed `[[wikilinks]]` in the new card pointing to related candidates when meaningfully related. |
| **update** | Existing card covers the same insight but lacks new detail |
| **skip** | Insight is duplicate, too obvious, or not durable |

Rules:
- **Merge/archive is out of scope** for this version unless the user explicitly asks.
- Links must be chosen by the agent after reading candidate cards. Embedding
  similarity or keyword match is only a candidate signal, not an automatic
  link decision.
- Updating existing cards is allowed only after preview (Step 6).

### Step 6: Preview

Before writing, produce a preview of planned changes:

```
Planned memory changes:
- create: <slug> (<title>)
- update: <slug> because <reason why update is better than new card>
- links: [[a]], [[b]] because <relationship explanation>
- metadata: context/keywords/tags draft
```

For updates to existing cards, the agent MUST explain why updating is
preferable to creating a new card.

### Step 7: Write

Use existing memex write paths:

```bash
memex write <slug> << 'EOF'
---
title: <title>
created: <YYYY-MM-DD>
source: <client>
category: <optional>
context: <one sentence>
keywords: <comma-separated terms>
tags: <comma-separated categories>
---

<One atomic insight in your own words.>

This relates to [[existing-card]] because <explicit relationship explanation>.
EOF
```

On update, copy ALL existing frontmatter fields from the current card (title,
created, source, category, context, keywords, tags, and any custom fields).
Only modify the specific fields previewed in Step 6. Append new information
to the body.

### Step 8: Verify

After writing:

```bash
memex read <slug>
```

Confirm:
- Required frontmatter exists (title, created, source)
- Wikilinks are syntactically valid (`[[slug]]` format)
- Body contains the intended insight

## Rules

- **Atomic**: One insight per card. Multiple insights = multiple cards.
- **Own words**: Distill and rephrase. Don't copy-paste.
- **Links in context**: `[[links]]` must appear in sentences explaining the relationship.
  - Good: "This contradicts the approach in [[jwt-migration]] — stateless tokens can't be revoked."
  - Bad: "Related: [[jwt-migration]]"
- **No auto-linking**: Never add links based solely on keyword overlap or embedding score.
- **No silent mutation**: Never update an existing card without the preview step.
- **Preserve frontmatter**: When updating, copy all existing frontmatter fields. Only change fields explicitly previewed.
- **Metadata as strings**: Use comma-separated strings for keywords/tags, not arrays.
- **Fallback**: If the feature flag is disabled, use `memex-retro` instead.
