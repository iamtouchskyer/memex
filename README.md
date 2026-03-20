# memex

A Zettelkasten-based memory system for AI agents. No vector database, no embeddings — just markdown files with bidirectional links.

## How it works

```
Agent completes task → retro skill distills insights into atomic cards
                       ↓
Agent starts new task → recall skill searches cards, follows [[links]]
                       ↓
Cron runs periodically → organize skill maintains card network health
```

The LLM **is** the semantic search engine. `[[Bidirectional links]]` **are** the graph traversal engine. Together they replace vector databases entirely.

### The Zettelkasten method, automated

Niklas Luhmann built a 90,000-card knowledge system that produced 70 books. His method:

1. **Atomic notes** — one idea per card
2. **Write in your own words** — forces understanding
3. **Link with context** — "this relates to [[X]] because..."
4. **Keyword index** — curated entry points, not tags

memex gives this to AI agents. The retro skill writes cards like Luhmann wrote notes. The recall skill navigates them like Luhmann pulled cards from his box. The organize skill maintains the network like Luhmann reviewed his collection.

## Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Claude   │  │ Python   │  │ Human    │
│ Code     │  │ Agent    │  │ (CLI /   │
│ (skill)  │  │ (subprocess)│ Obsidian)│
└────┬─────┘  └────┬─────┘  └────┬─────┘
     └──────┬──────┴──────┬──────┘
            │             │
     ┌──────▼──────┐      │
     │  memex CLI  │◄─────┘
     │  (pure data │
     │   layer)    │
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │ ~/.memex/   │
     │ cards/*.md  │
     └─────────────┘
```

**CLI** = pure data layer (search/read/write/links/archive). Zero LLM dependency.

**Skills** = intelligence layer. Uses the agent's own LLM to search, write, and organize cards.

**Storage** = flat markdown files. Open them in Obsidian, edit with vim, grep from terminal. Your memory is never locked in.

## Install

```bash
# CLI
npm install -g @touchskyer/memex

# Claude Code plugin
/plugin marketplace add iamtouchskyer/memex
/plugin install memex@memex
```

## CLI

```bash
memex search "JWT revocation"     # body-only search, top 10 results
memex search                      # list all cards
memex read jwt-migration          # full card content
memex write new-card < card.md    # write card (stdin)
memex links                       # global link graph stats
memex links jwt-migration         # inbound/outbound links for a card
memex archive old-card            # move to ~/.memex/archive/
```

## Skills

| Skill | When | What it does |
|-------|------|-------------|
| `/memex-recall` | Task start | Reads keyword index → targeted card reads → follows [[links]] |
| `/memex-retro` | Task end | Distills insights → dedup check → writes atomic cards with [[links]] |
| `/memex-organize` | Periodic | Detects orphans/hubs → fixes links → rebuilds keyword index |

A **SessionStart hook** auto-injects the keyword index into every new conversation.

## Card format

```markdown
---
title: JWT revocation needs a blacklist
created: 2026-03-18
source: retro
---

Stateless tokens can't be revoked. The only workaround is maintaining
a blacklist of revoked token IDs — which reintroduces state.

This is the fundamental tension in [[stateless-auth]]: moving state to
the client means the server loses control. We used [[redis-session-store]]
as the blacklist backend, which works but defeats the purpose of going
stateless in the first place.
```

Cards are atomic. Links are in prose, not metadata. Context explains the relationship.

## Why not vector search?

| | Vector DB (mem0, etc.) | memex |
|---|---|---|
| Semantic matching | Embedding model | LLM generates multiple queries |
| Relationship discovery | Cosine similarity (implicit) | `[[links]]` (explicit) |
| Retrieval | One-shot top-K | Iterative exploration |
| Explainability | Opaque | Human-readable |
| Infrastructure | Qdrant/ChromaDB | `~/.memex/cards/` |
| Debugging | Good luck | Open the .md file |

The trade-off: more LLM tokens for full transparency. Tokens get cheaper every year.

## License

MIT
