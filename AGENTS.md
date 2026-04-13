# Memex — Agent Working Instructions

> Detailed architecture reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## What Is This

Zettelkasten memory for AI agents. Markdown cards in `~/.memex/cards/` with `[[wikilinks]]`. npm package `@touchskyer/memex`. Distributed as CLI + MCP server + Claude Code plugin + VS Code extension + Pi extension.

## Before You Touch Anything

```bash
npm test          # must pass. vitest, 70% coverage threshold.
```

Build has a known TS error (`node-llama-cpp` optional dep). Ignore it — it compiles fine for distribution.

## How The Code Is Layered

```
MCP tools (src/mcp/)  →  Commands (src/commands/)  →  Lib (src/lib/)  →  Filesystem (~/.memex/)
     ↑ client-facing         ↑ business logic           ↑ data access
```

**The rule**: MCP tools and CLI are thin wrappers. All logic lives in `src/commands/`. All data access in `src/lib/store.ts`. Don't put logic in the wrong layer.

## Files You'll Actually Need

| When you're changing... | Read these first |
|------------------------|-----------------|
| Card read/write/slug behavior | `src/lib/store.ts` (164 lines — read all of it) |
| MCP tool behavior | `src/mcp/operations.ts` (high-level), `src/mcp/server.ts` (low-level) |
| Search (keyword or semantic) | `src/commands/search.ts` (most complex file, ~390 lines) |
| Sync / git operations | `src/lib/sync.ts` (GitAdapter, autoSync, autoFetch) |
| Embeddings | `src/lib/embeddings.ts` (3 providers + cache) |
| Card parsing / frontmatter | `src/lib/parser.ts` (47 lines — tiny but critical) |
| Organize / graph analysis | `src/commands/organize.ts` |
| Claude Code plugin hooks | `hooks/hooks.json` |
| VS Code extension | `vscode-extension/src/extension.ts` |
| Pi extension | `pi-extension/index.ts` |

## Do / Don't

### DO

- Keep commands pure: return `{output, exitCode}` or `{success, content/error}`. Let CLI/MCP handle I/O.
- Use `.js` extensions in all imports (Node16 ESM resolution).
- Test both `nestedSlugs: false` (default) and `nestedSlugs: true` when touching `store.ts`.
- Run `npm test` before declaring anything done.
- Add new MCP tools in `operations.ts` if they need hooks, in `server.ts` if they don't.
- Use `zod` for MCP tool input schemas (already imported in both MCP files).

### DON'T

- Don't replace the custom YAML stringifier in `parser.ts` with `js-yaml` — it produces block scalars (`>-`) that break downstream parsers.
- Don't put business logic in `cli.ts` — it's orchestration only.
- Don't make hooks throw. `HookRegistry.run()` swallows errors by design. Hooks are infrastructure.
- Don't use `gray-matter` for stringification — only for parsing. The custom `stringifyFrontmatter` exists for a reason.
- Don't add heavy dependencies. This is a 4-dep project (`commander`, `gray-matter`, `zod`, `@modelcontextprotocol/sdk`). Keep it that way.
- Don't forget to call `store.invalidateCache()` after any write/delete path that bypasses `writeCard()`/`archiveCard()`.

## Mutation Checklist

If you **add a new MCP tool**:
1. Add in `server.ts` (no hooks) or `operations.ts` (with hooks)
2. Schema with `zod`, return `{ content: [{ type: "text", text }] }`
3. Add tests

If you **add a new CLI command**:
1. Create `src/commands/<name>.ts`
2. Register in `src/cli.ts`
3. Add tests

If you **change card format / frontmatter**:
1. Update `parser.ts` (parse + stringify)
2. Check `store.ts` (slug validation)
3. Ensure backward compat — old cards must still parse
4. Update `docs/ARCHITECTURE.md` § Data Model

If you **add an embedding provider**:
1. Implement `EmbeddingProvider` interface in `embeddings.ts`
2. Add to `EmbeddingProviderType` union + `createEmbeddingProvider()` factory
3. Add config fields in `config.ts`
4. Update auto-detection fallback chain (order matters: OpenAI → Local → Ollama → yours)

If you **change sync behavior**:
1. All in `src/lib/sync.ts` (GitAdapter)
2. `autoSync()` / `autoFetch()` are called by hooks — test offline tolerance

## Key Design Decisions (Don't Undo These)

- **Atomic writes**: `writeCard()` → `.tmp` → `rename()`. Prevents corruption.
- **Path safety**: `validateSlug()` + `assertSafePath()` = no directory traversal. Ever.
- **Client source tagging**: MCP server captures `clientInfo.name` at init, injects into `source` frontmatter. This is how we track which client wrote each card.
- **Hooks fail silently**: They're git sync calls, not user-facing logic. If git is offline, don't crash.
- **Embedding cache invalidation**: SHA-256 content hash per card. Stale entries cleaned on `embedCards()`. Don't switch to timestamp-based — content hash is correct.

## Flomo Integration (Bidirectional Sync)

Memex has bidirectional sync with flomo. Two hard rules:

### Flomo → Memex (Import)

- **Digest, never mechanical import.** Flomo memos are fleeting notes, NOT Zettelkasten cards. The agent must read, curate, and rewrite into atomic insights.
- All imported cards get `source: flomo` in frontmatter.
- Use `flomoImportCommand` for bulk parsing, or `flomo_import_parse` MCP tool to preview memos before curating.
- Quality bar: skip garbage (<150 bytes), merge related memos, extract only non-obvious insights.

### Memex → Flomo (Push)

- **Anti-loopback: NEVER push `source: flomo` cards back to flomo.** This is enforced in code (`pushSingleCard` + batch filter in `flomoPushCommand`). Don't remove it.
- Push via webhook (`flomoPushCommand`). Webhook URL validated at both read and write time (defense in depth).

### Code Locations

| What | Where |
|------|-------|
| All flomo logic | `src/commands/flomo.ts` |
| MCP tools | `src/mcp/operations.ts` (flomo_push, flomo_import_parse) |
| Anti-loopback guard | `pushSingleCard()` line ~135, batch filter line ~410 |
| Webhook validation | `isValidFlomoWebhookUrl()` — HTTPS + flomoapp.com + /iwh/ prefix |
| Tests | `tests/commands/flomo.test.ts`, `tests/commands/flomo-import.test.ts` |

## Platform Integration Files

```
Claude Code:  hooks/hooks.json, skills/*, .claude-plugin/*
VS Code:      vscode-extension/
Pi:           pi-extension/index.ts
```

These are separate integration surfaces. Changing core code doesn't require updating them unless you change tool signatures or card format.
