# Dev Spec: Experimental Agentic Memory Skill

Status: Draft
Date: 2026-05-03
Related PRD: `docs/superpowers/specs/2026-05-03-agentic-memory-skill-prd.md`

## Design Principle

Do not build an A-MEM clone inside memex core. Build an A-MEM-inspired skill workflow that leverages the current agent plus existing memex tools.

The core boundary remains:

```text
MCP tools / CLI -> commands -> lib -> filesystem
```

Agentic reasoning stays in the skill. Core memex remains responsible for configuration, parsing, path safety, atomic writes, search, and sync.

## Proposed Architecture

```text
skills/memex-agentic-memory/SKILL.md
  -> uses memex_search / memex_read / memex_write / memex_retro
  -> performs agent reasoning for create (with links), update, skip
  -> gated by .memexrc.experimental.agenticMemory

src/lib/config.ts
  -> parses experimental.agenticMemory
  -> default false

optional later, separate from agentic-memory v1:
src/commands/search.ts / src/lib/embeddings.ts
  -> enhanced retrieval text as an independent search improvement with its own tests
```

## Feature Flag

Add `experimental` to the existing `MemexConfig` interface (which already has ~15 fields for embedding providers, search dirs, etc.):

```typescript
// Add to the existing MemexConfig interface in src/lib/config.ts
experimental?: {
  agenticMemory?: boolean;
};
```

Add parsing in `readConfig()` alongside the existing field parsers:

```typescript
experimental: parseExperimental(parsed.experimental),
```

Parsing rules:

- `experimental` must be an object (not null, string, number, or array).
- `agenticMemory` is enabled only when the value is exactly `true`.
- Missing, false, null, string, or number values are treated as disabled.
- Existing config keys remain backward compatible.
- The `readConfig` function already uses strict type checks per field; follow the same pattern.

Example `.memexrc`:

```json
{
  "experimental": {
    "agenticMemory": true
  }
}
```

## Skill Guard

The skill must start with a guard step:

1. Locate memex home using the same precedence as core memex where possible: `MEMEX_HOME`, upward `.memexrc`, then `~/.memex`.
2. Read `.memexrc`.
3. Continue only if `experimental.agenticMemory === true`.
4. If disabled, fall back to existing `memex-retro` behavior and do not perform agentic update workflow.

A later PR may add a small CLI helper such as `memex config get experimental.agenticMemory`, but the first skill can self-gate through file inspection if needed.

## Skill Workflow

### Step 1: Input Triage

Identify whether there is a memory-worthy insight. Skip if the content is temporary, obvious, or not reusable.

### Step 2: Draft Atomic Card

Produce one card per insight:

- short title
- kebab-case slug
- one atomic body
- explicit project/domain context when needed

### Step 3: Metadata Draft

Generate candidate metadata:

- `context`: one sentence explaining domain and purpose
- `keywords`: 3-8 salient terms
- `tags`: broad categories useful for retrieval

Important: metadata storage is experimental. Until frontmatter serialization is finalized, the skill must not rely on array round-tripping through `writeCommand`.

### Step 4: Candidate Retrieval

Run retrieval before writing:

```text
memex search "<topic query>" --semantic --compact --limit 8
```

If semantic search fails or is unavailable:

```text
memex search "<topic query>" --compact --limit 8
```

Read the top candidates that look relevant:

```text
memex read <slug>
```

Recommended limits:

- max candidate searches: 3
- max cards read: 10
- max link hops: 2

### Step 5: Decision

Choose exactly one primary action per insight:

| Action | When |
|--------|------|
| create | No existing card covers the insight |
| create with links | No existing card covers the insight, but candidate cards are meaningfully related — create a new card and embed wikilinks with relationship explanations |
| update | Existing card covers the same insight but lacks new detail (requires preview) |
| skip | Insight is duplicate, too obvious, or not durable |

Note: there is no "link-only" action in v1. Adding wikilinks to an existing card without other changes is an update and requires the update preview flow.

Merge/archive is excluded from v1 unless the user explicitly asks.

### Step 6: Preview

Before writing, produce a preview:

```text
Planned memory changes:
- create: <slug> (<title>)
- update: <slug> because <reason>
- links: [[a]], [[b]] because <relationship>
- metadata: context/keywords/tags draft
```

For updates to existing cards, the agent must explain why updating is better than creating a new card.

### Step 7: Write

Use existing memex write paths. Preserve frontmatter on update.

For a new card, required fields remain:

```yaml
---
title: <title>
created: <YYYY-MM-DD>
source: <client or agent>
category: <optional>
---
```

Links must be embedded in prose with relationship explanations, not appended as an unstructured list.

### Step 8: Verify

After writing:

- read the written card
- confirm required frontmatter exists
- confirm wikilinks are syntactically valid
- optionally run `memex links <slug>` or `memex doctor` in a later implementation phase

## Frontmatter Serialization Constraint

Current `stringifyFrontmatter` in `src/lib/parser.ts` iterates `Object.entries(data)`, calls `String(value)` on each, and emits bare or single-quoted YAML scalars. It does not handle arrays — an array value becomes its `toString()` representation (e.g. `"a,b,c"`), which `parseFrontmatter` (via `gray-matter`) will read back as a single string, not an array. Round-tripping arrays through write→read is therefore lossy.

**v1 decision: use comma-separated string fields.**

Store experimental metadata as simple string scalars. This is safe with the current serializer and avoids blocking on a parser improvement PR:

```yaml
context: One sentence summary.
keywords: 'retrieval, metadata, agentic memory'
tags: 'memory, workflow, experimental'
```

Note: `stringifyFrontmatter` single-quotes values that contain commas, so the on-disk representation will use quotes as shown above. The skill must treat these as opaque strings on read (split on `, ` if needed) and must not assume array semantics. A future PR may improve `stringifyFrontmatter` to support YAML sequences, at which point the skill can migrate.

## Testing Strategy

### Config Tests

Add tests in `tests/lib/config.test.ts`:

- reads `experimental.agenticMemory: true`
- treats false/missing/invalid values as disabled
- preserves existing config fields

### Skill Tests

If the repo has a skill packaging test, add coverage that the new skill exists and contains the feature flag guard. If not, keep skill validation manual in the first PR.

### Behavior Tests

No core behavior should change when the flag is disabled. Existing tests must pass without updating snapshots for default behavior.

## PR Slicing

### PR 1: PRD and Dev Spec

Files only:

- `docs/superpowers/specs/2026-05-03-agentic-memory-skill-prd.md`
- `docs/superpowers/specs/2026-05-03-agentic-memory-skill-dev-spec.md`

### PR 2: Feature Flag Parsing

Files:

- `src/lib/config.ts`
- `tests/lib/config.test.ts`
- `docs/ARCHITECTURE.md` config section

No behavior change.

### PR 3: Experimental Skill

Files:

- `skills/memex-agentic-memory/SKILL.md`
- optional plugin packaging references if required
- docs update describing opt-in behavior

No core command changes.

### PR 4: Retrieval Substrate

Optional and separate from agentic-memory v1. Improve semantic retrieval text to include existing metadata such as title, category, context, keywords, and tags. Treat this as a normal search improvement with its own tests and review; the agentic-memory flag must not be required for it.

### PR 5: Helper Workflow

Optional. Add a read-only helper that returns candidate neighbors for agent review. It must not write links or update cards.

## Multica Harness Plan

Use Multica only for small research and review sprints.

Branch policy:

- Use `agentic-memory-harness` as the shared integration branch.
- Commit sprint work to that branch instead of opening frequent upstream PRs.
- Push the branch to the `litaohz/memex` fork so Generator, Evaluator, and Leader can inspect the same history.
- Open or draft an upstream PR only when Leader recommends a coherent milestone slice.

- Generator: drafts one doc or small patch per sprint.
- Evaluator: checks for scope creep, missing flag guard, and accidental behavior changes.
- Leader: summarizes the day's findings and proposes the next small PR.

Sprint constraints:

- max 5 files
- max 200 changed lines for code PRs
- docs PRs may exceed 200 lines only when they are the sole change
- no automatic mutation feature without an accepted design doc

## Resolved Implementation Questions

- **Feature flag check location:** Skill-only in v1. The skill reads `.memexrc` directly via file inspection. A `memex config get` CLI helper is deferred to a later PR.
- **Metadata storage:** Comma-separated string scalars in frontmatter (see Frontmatter Serialization Constraint above). No body-section workaround needed.
- **Semantic search and the flag:** Enhanced retrieval is not required for agentic-memory v1. If pursued, it is a separate search improvement with its own tests; the agentic skill may benefit from it but does not own it.
- **Preview for new cards:** New-card-only writes still produce a preview, but may proceed without extra user confirmation. Updates to existing cards always require preview. This matches FR7/FR8 in the PRD.
