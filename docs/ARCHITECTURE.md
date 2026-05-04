# Memex Architecture Reference

> Comprehensive technical documentation for contributors and AI coding agents.
> For quick-start instructions, see the root README.md.

## 1. Project Overview

**Memex** (`@touchskyer/memex`, v0.1.26) is a persistent Zettelkasten memory system for AI coding agents. It stores atomic knowledge cards as markdown files in `~/.memex/cards/`, using `[[wikilinks]]` for bidirectional linking. No vector database, no embeddings required (optional).

**Core philosophy**: Recall → Work → Retro. Every session starts by recalling prior knowledge, ends by saving new insights.

**Repository**: https://github.com/iamtouchskyer/memex
**License**: MIT

## 2. Architecture Layers

```
┌─────────────────────────────────────────────┐
│              Client Layer                   │
│  Claude Code │ VS Code │ Cursor │ Pi │ MCP │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           MCP Server (src/mcp/)             │
│  10 tools: recall, retro, organize,         │
│  search, read, write, links, archive,       │
│  pull, push                                 │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Command Layer (src/commands/)      │
│  search, read, write, links, backlinks,     │
│  archive, organize, serve, sync, import,    │
│  doctor, migrate                            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Library Layer (src/lib/)           │
│  CardStore, Parser, Formatter, HookRegistry,│
│  GitAdapter, EmbeddingProvider, Config       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Storage (~/.memex/)               │
│  cards/  archive/  .sync.json  .memexrc     │
└─────────────────────────────────────────────┘
```

## 3. Source Code Map

```
src/
├── cli.ts                    # CLI entry point (commander)
├── mcp/
│   ├── server.ts             # MCP server factory, client-aware source tagging
│   └── operations.ts         # High-level MCP tools: recall, retro, organize, pull, push
├── commands/
│   ├── search.ts             # Keyword + semantic search, manifest pre-filter
│   ├── read.ts               # Read card by slug
│   ├── write.ts              # Write card (validates frontmatter, updates modified date)
│   ├── links.ts              # Link graph stats (single card or global)
│   ├── backlinks.ts          # Find cards linking TO a slug
│   ├── archive.ts            # Move card to archive/
│   ├── organize.ts           # Network analysis: orphans, hubs, conflicts, pairs
│   ├── serve.ts              # Web UI server (serve-ui.html)
│   ├── sync.ts               # CLI sync orchestrator (init, pull, push, auto toggle)
│   ├── import.ts             # Import dispatcher
│   ├── doctor.ts             # Health checks (slug collision detection)
│   └── migrate.ts            # Config migration (enable nestedSlugs)
├── lib/
│   ├── store.ts              # CardStore: scan, resolve, read, write, archive (atomic writes)
│   ├── parser.ts             # Frontmatter parse/stringify, wikilink extraction
│   ├── formatter.ts          # Output formatters (card list, search result, link stats)
│   ├── hooks.ts              # HookRegistry: pre/post lifecycle hooks
│   ├── sync.ts               # GitAdapter, SyncConfig, autoSync/autoFetch
│   ├── config.ts             # .memexrc reader
│   ├── embeddings.ts         # OpenAI/Azure/Local/Ollama providers, cache, cosine similarity
│   └── utils.ts              # semverSort utility
├── importers/
│   ├── index.ts              # Importer registry
│   └── openclaw.ts           # OpenClaw importer
skills/                       # Claude Code skills (bundled in plugin)
├── memex-recall/SKILL.md
├── memex-retro/SKILL.md
├── memex-organize/SKILL.md
├── memex-sync/SKILL.md
├── memex-best-practices/SKILL.md
├── memex-agentic-memory/SKILL.md  # Experimental (requires agenticMemory flag)
└── agent-prompts-warmup/SKILL.md  # FRE audit and agent instruction sync
hooks/
└── hooks.json                # Claude Code SessionStart hook
.claude-plugin/
├── plugin.json               # Plugin metadata
└── marketplace.json          # Claude Code marketplace registration
pi-extension/
└── index.ts                  # Pi agent extension (8 tools, lifecycle hooks)
vscode-extension/             # VS Code extension (bundles MCP server)
tests/                        # Vitest test suite
```

## 4. Data Model

### Card Format

File: `~/.memex/cards/<slug>.md`

```yaml
---
title: Short Noun Phrase (<=60 chars)
created: 2025-01-15
modified: 2025-01-16
source: claude-code
category: backend
tags: [typescript, gotcha]
status: conflict
---

Atomic insight in own words, with [[wikilinks]] to related cards.

This connects to [[jwt-revocation]] because stateless tokens
need server-side revocation via [[blacklist-pattern]].
```

**Required fields**: `title`, `created`, `source`
**Auto-managed**: `modified` (updated on every write), `source` (injected by MCP server from clientInfo)

### Slug Rules

- **Format**: kebab-case, lowercase English, 3-60 chars
- **Validation** (`store.ts:validateSlug`):
  - No empty/whitespace-only slugs
  - No reserved chars: `: * ? " < > |`
  - No empty path segments, no `..` traversal
  - Path-safe assertion: must resolve within `cardsDir`
- **Special prefixes**: `adr-*`, `gotcha-*`, `pattern-*`, `tool-*`

### Storage Layout

```
~/.memex/
├── cards/              # Active cards (.md)
├── archive/            # Archived cards
├── .sync.json          # Sync config (remote, auto, lastSync)
├── .memexrc            # User config (JSON)
├── .last-organize      # Timestamp of last organize
├── .memex/embeddings/  # Embedding cache (per-model JSON)
└── .git/               # Git repo (if sync initialized)
```

## 5. MCP Tools (10 total)

### High-Level (with hooks)

| Tool | Purpose | Hooks |
|------|---------|-------|
| `memex_recall` | Load prior knowledge at task start. Returns index card or card list. | `pre:recall` (autoFetch) |
| `memex_retro` | Save atomic insight at task end. Auto-injects source, date, syncs. | `pre:retro` (autoFetch), `post:retro` (autoSync) |
| `memex_organize` | Analyze network: orphans, hubs, conflicts, contradiction pairs. | `pre:organize` (autoFetch), `post:organize` (autoSync) |
| `memex_pull` | Pull remote changes. | `pre:pull`, `post:pull` |
| `memex_push` | Push local changes. | `pre:push`, `post:push` |

### Low-Level (no hooks)

| Tool | Purpose |
|------|---------|
| `memex_search` | Full-text keyword search (AND logic) or list all cards |
| `memex_read` | Read card by slug |
| `memex_write` | Write/update card with full content |
| `memex_links` | Link stats (per-card or global) |
| `memex_archive` | Move card to archive |

## 6. Hook System

**Registry** (`src/lib/hooks.ts`): `Map<HookKey, HookFn[]>` where `HookKey = "${Phase}:${Operation}"`.

- **Phase**: `pre` | `post`
- **Operation**: `recall` | `retro` | `organize` | `show` | `pull` | `push` | `init`
- **Behavior**: hooks fail silently (infrastructure, not business logic)

**Default hooks** (registered in `server.ts`):

```
pre:recall   → autoFetch (pull latest)
pre:retro    → autoFetch
pre:organize → autoFetch
post:retro   → autoSync (commit + push if auto=true)
post:organize → autoSync
```

## 7. Sync System

**Adapter**: `GitAdapter` (`src/lib/sync.ts`)

- **Init**: Creates/reuses `memex-cards` GitHub repo via `gh` CLI, or accepts custom URL
- **Pull**: `git fetch origin` → `git merge <remoteBranch> --no-edit`
- **Push**: `git add cards archive` → `git commit` → `git push origin HEAD`
- **Remote detection**: `origin/HEAD` → `origin/main` → `origin/master` → fallback `origin/main`
- **Auto-sync**: Enabled with `memex sync on`. Runs after retro/organize.
- **Offline tolerance**: autoFetch/autoSync silently fail when offline

## 8. Search

### Keyword Search (default)

- AND logic: ALL tokens must match
- Case-insensitive, searches title + body (frontmatter excluded)
- Ranked by token frequency

### Semantic Search (`--semantic`)

- Providers: OpenAI (`text-embedding-3-small`), Azure OpenAI (`text-embedding-3-large` deployment), Local (`node-llama-cpp` + GGUF), Ollama (`nomic-embed-text`)
- Hybrid scoring: `0.7 * semantic + 0.3 * keyword_normalized`
- Embedding cache: `~/.memex/.memex/embeddings/<model>.json`, invalidated by SHA-256 content hash
- Auto-detection: OpenAI API key -> Azure OpenAI endpoint + key -> node-llama-cpp -> error; Ollama is explicit-only

### Manifest Filters

`--category`, `--tag`, `--author/--source`, `--since`, `--before` (applied as pre-filter before search)

## 9. Organize

`organizeCommand` (`src/commands/organize.ts`) builds full link graph:

1. **Link stats**: outbound/inbound counts per card
2. **Orphan detection**: cards with 0 inbound (excluding `index`)
3. **Hub detection**: cards with ≥10 inbound
4. **Conflict cards**: frontmatter `status: conflict`
5. **Contradiction pairs**: recently modified cards + their neighbors (max 20 pairs, 300-char excerpts)
6. **Incremental**: uses `~/.memex/.last-organize` timestamp; `--since` overrides

## 10. Platform Integrations

### Claude Code Plugin

- **SessionStart hook** (`hooks/hooks.json`): checks CLI install, runs sync, injects recall/retro reminders
- **7 skills**: recall, retro, organize, sync, best-practices, agentic-memory (experimental), agent-prompts-warmup
- **Install**: `/plugin install memex@memex`
- **Marketplace**: `.claude-plugin/marketplace.json`

### VS Code Extension

- **Location**: `vscode-extension/`
- Bundles `@touchskyer/memex` as dependency
- Registers MCP server via `vscode.lm.registerMcpServerDefinitionProvider`
- Node discovery: system PATH → common install paths → NVM (sorted by semver)

### Pi Extension

- **Location**: `pi-extension/index.ts`
- Single file, zero npm dependencies
- 8 tools (spawns `memex` CLI process)
- Lifecycle hooks: `before_agent_start` (recall reminder), `agent_end` (retro reminder)
- Slash commands: `/memex`, `/memex-serve`, `/memex-sync`

## 11. Build & Test

### Build

```bash
npm run build      # tsc → dist/
npm run postbuild  # copies serve-ui.html, share-card assets, syncs AGENTS.md → agent instruction files
```

**TypeScript**: ES2022, Node16 module resolution, strict mode, declarations, source maps.

### Dependencies

| Dep | Purpose |
|-----|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `commander` | CLI framework |
| `gray-matter` | YAML frontmatter parsing |
| `zod` | Schema validation (MCP tool inputs) |

**Optional**: `node-llama-cpp` (local embeddings)

### Test

```bash
npm test              # vitest run
npm run test:watch    # vitest watch mode
```

**Coverage**: v8 provider, 70% statement threshold, `src/cli.ts` excluded.

### Package Distribution

- **npm**: `@touchskyer/memex` (includes `dist/`, `skills/`, `pi-extension/`)
- **VS Code**: `touchskyer.memex-mcp` marketplace extension
- **Claude Code**: plugin via marketplace (`memex@memex`)
- **Binary**: `memex` (via `package.json` `bin` field → `dist/cli.js`)

## 12. Configuration Reference

### .memexrc (JSON)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `nestedSlugs` | boolean | false | Path-preserving slugs |
| `searchDirs` | string[] | — | Extra dirs for `--all` |
| `embeddingProvider` | "openai"\|"azure"\|"local"\|"ollama" | auto-detect | |
| `openaiApiKey` | string | env `OPENAI_API_KEY` | |
| `openaiBaseUrl` | string | `https://api.openai.com` | |
| `embeddingModel` | string | `text-embedding-3-small` | OpenAI model or Azure deployment | |
| `azureOpenaiEndpoint` | string | env `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint, e.g. `/openai/v1/` |
| `azureOpenaiApiKey` | string | env `AZURE_OPENAI_API_KEY` | Prefer env/key file |
| `azureOpenaiApiKeyPath` | string | `~/.azure_api_key` | Local key file path |
| `ollamaModel` | string | `nomic-embed-text` | |
| `ollamaBaseUrl` | string | `http://localhost:11434` | |
| `localModelPath` | string | HuggingFace URI | |
| `experimental` | object | — | Experimental feature flags (see below) |

#### Experimental Flags

The `experimental` field is an optional object for gating features that are not yet stable.

| Flag | Type | Default | Notes |
|------|------|---------|-------|
| `agenticMemory` | boolean | `false` | Enables the A-MEM-inspired agentic memory skill workflow. Only `true` activates; `false`, `null`, missing, or non-boolean values are treated as disabled. |

Example `.memexrc` with experimental flags:

```json
{
  "experimental": {
    "agenticMemory": true
  }
}
```

When `agenticMemory` is enabled, agents may use the `memex-agentic-memory` skill for structured knowledge capture (observe → draft → enrich → retrieve → decide → preview → write → verify). When disabled, agents use the standard `memex-retro` workflow. See `skills/memex-agentic-memory/SKILL.md` for the full skill specification.

### Environment Variables

| Var | Purpose |
|-----|---------|
| `MEMEX_HOME` | Override home dir (default `~/.memex`) |
| `OPENAI_API_KEY` | OpenAI embeddings |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_API_KEY_FILE` | Azure OpenAI API key file path |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Azure OpenAI embedding deployment override |
| `OPENAI_BASE_URL` | Custom OpenAI endpoint |
| `MEMEX_EMBEDDING_PROVIDER` | Force provider type |
| `MEMEX_OLLAMA_MODEL` | Ollama model override |
| `MEMEX_OLLAMA_BASE_URL` | Ollama endpoint override |

## 13. Key Implementation Details

### Atomic Writes

`CardStore.writeCard()` writes to `<path>.tmp` then `rename()` — prevents corruption on crash.

### Cache Invalidation

- `CardStore.scanCache`: invalidated after every write/archive
- `EmbeddingCache`: SHA-256 content hash per card, stale entries cleaned on `embedCards()`

### Client Source Tagging

MCP server intercepts `initialize` handshake, captures `clientInfo.name`, normalizes to kebab-case. Auto-injected into `source` frontmatter on writes via `memex_write` and `memex_retro`.

### Path Safety

- `assertSafePath()`: resolved path must be within `cardsDir` (or `archiveDir`)
- `validateSlug()`: rejects traversal, reserved chars, empty segments
- Windows normalization: `\` → `/` in slugs

### Frontmatter Stringification

Custom YAML generation (avoids `js-yaml` block scalars `>-`):
- Special chars quoted with single quotes
- Single quotes escaped: `'` → `''`
- Newlines replaced with spaces
