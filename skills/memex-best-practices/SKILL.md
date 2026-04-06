---
name: memex-best-practices
description: Zettelkasten best practices for building a high-quality knowledge graph.
whenToUse: When the user asks about how to write good memory cards, naming conventions, linking strategies, or general Zettelkasten methodology. Also useful as a reference when writing or reviewing cards.
---

# Zettelkasten Best Practices

A reference guide for writing high-quality memex cards that compound in value over time. Covers card format, naming conventions, tagging, linking strategy, and graph health maintenance.

This is NOT a workflow skill (see `memex-recall`, `memex-retro`, `memex-organize` for those). This is a **quality standard** — consult it when writing or reviewing cards.

## Card Quality Checklist

Before writing a card, verify:

- [ ] **Atomic** — one insight per card. If you can split it, do.
- [ ] **Own words** — distill and rephrase, don't copy-paste. This is the Feynman method: if you can't explain it simply, you don't understand it well enough.
- [ ] **Non-obvious** — would this change how you approach a similar task in the future? If not, skip it.
- [ ] **Linked in context** — `[[wikilinks]]` are embedded in sentences explaining *why* the relationship exists.

## Card Format

```markdown
---
title: "Short Noun Phrase ≤60 chars"
created: "YYYY-MM-DD"
source: "<auto-filled by client>"
tags: [domain-tag, type-tag]
category: "<domain>"
---

One atomic insight, written in your own words.

This relates to [[other-card]] because <explanation of the relationship>.
```

### Required Frontmatter

| Field     | Required | Format                          |
|-----------|----------|---------------------------------|
| `title`   | ✅       | Noun phrase, ≤60 chars          |
| `created` | ✅       | ISO date `YYYY-MM-DD`           |
| `source`  | ✅       | Auto-filled by MCP/CLI client   |

### Optional Frontmatter

| Field      | Format                  | Notes                                    |
|------------|-------------------------|------------------------------------------|
| `tags`     | YAML list               | See [Tag System](#tag-system) below       |
| `category` | Single string           | See [Categories](#categories) below       |
| `links`    | YAML list of slugs      | Explicit links (in addition to wikilinks) |
| `status`   | `conflict` / `draft`    | Set by organize skill when needed         |

### Body Rules

- Write in **plain Markdown**
- Use `[[slug]]` wikilinks inline, within natural sentences
- Keep cards concise — aim for a few paragraphs, not an essay
- Code examples are fine, but the insight should stand without them

## Slug Naming

Slugs are permanent identifiers. Choose them carefully.

### Format

- **kebab-case**, all lowercase English
- **3–60 characters**
- Descriptive but concise

### Examples

| ✅ Good | ❌ Bad | Why |
|---------|--------|-----|
| `docker-compose-port-binding` | `note-1` | Descriptive vs. meaningless |
| `jwt-revocation-blacklist` | `docker` | Specific vs. too broad |
| `nextjs-app-router-caching` | `how-to-fix-the-bug-we-found` | Noun phrase vs. sentence |
| `vitest-mock-timer-gotcha` | `vitest_mock_timer` | kebab-case vs. snake_case |

### Special Slug Prefixes

Use these prefixes to signal card type at a glance:

| Prefix      | Use                                | Example                        |
|-------------|------------------------------------|--------------------------------|
| `adr-*`     | Architecture decision records      | `adr-monorepo-vs-polyrepo`     |
| `gotcha-*`  | Pitfalls, traps, surprising behavior | `gotcha-yaml-date-auto-parse` |
| `pattern-*` | Reusable patterns, best practices  | `pattern-retry-with-backoff`   |
| `tool-*`    | Tool-specific tips and configs     | `tool-gh-cli-pagination`       |

These are conventions, not enforced constraints. Use them when they fit naturally.

## Categories

Assign one category per card to indicate its domain:

`architecture` · `backend` · `frontend` · `devops` · `tooling` · `security` · `workflow` · `testing` · `data`

Categories are broad. Use tags for fine-grained classification.

## Tag System

Tags serve two purposes: **domain** (what technology) and **type** (what kind of knowledge).

### Domain Tags

Use the specific technology or concept name:

`docker` · `nodejs` · `typescript` · `react` · `nextjs` · `postgres` · `redis` · `git` · `api` · `css` · `linux` · `aws` · `azure`

### Type Tags

Classify the kind of insight:

| Tag         | When to use                                  |
|-------------|----------------------------------------------|
| `decision`  | A choice was made between alternatives       |
| `gotcha`    | Surprising behavior, easy-to-miss pitfall    |
| `pattern`   | Reusable solution or approach                |
| `howto`     | Step-by-step procedure                       |
| `reference` | Factual lookup (config format, API shape)    |
| `debug`     | Root cause analysis of a specific bug        |

### Tagging Guidelines

- Use **1–3 tags** per card (one domain + one type is ideal)
- Prefer existing tags over creating new ones
- Tags are lowercase, single-word or hyphenated (`rate-limiting`, not `Rate Limiting`)

## Linking Strategy

Links are the most valuable part of a Zettelkasten. They create a network that surfaces unexpected connections.

### Link in Context

Every `[[wikilink]]` should appear in a sentence that explains the relationship:

```markdown
<!-- ✅ Good: link explains WHY -->
This contradicts what we found in [[jwt-migration]] — stateless tokens
can't be revoked without a server-side blacklist.

<!-- ❌ Bad: link without context -->
Related: [[jwt-migration]]
```

### When to Link

- **Contradiction** — "This conflicts with [[X]] because..."
- **Extension** — "This builds on [[X]] by adding..."
- **Example** — "[[X]] is a concrete instance of this pattern"
- **Alternative** — "We chose this over the approach in [[X]] because..."
- **Prerequisite** — "Understanding [[X]] is necessary context for this"

### Avoid Over-Linking

Not every card needs to link to every related card. Link when the connection would **surprise** someone or **change how they read** either card.

## The Keyword Index

The `index` card is a curated entry point to the entire knowledge graph — inspired by Luhmann's *Schlagwortregister* (keyword register).

### Purpose

- Provides structured entry points for the `memex-recall` skill
- Groups cards by concept, not by chronology
- Each card appears under 1–2 categories

### Format

```markdown
---
title: Keyword Index
created: <date>
source: organize
---

## Authentication
- [[jwt-revocation-blacklist]] — Server-side revocation for stateless tokens
- [[oauth2-pkce-flow]] — PKCE flow for public clients (SPAs, mobile)

## Docker
- [[docker-compose-port-binding]] — 0.0.0.0 vs 127.0.0.1 gotcha
- [[docker-multi-stage-builds]] — Reducing image size with build stages
```

The index is maintained by the `memex-organize` skill. You can also update it manually after writing cards.

## The Recall → Work → Retro Loop

The core memex workflow is a learning cycle:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  RECALL  │───▶│   WORK   │───▶│  RETRO   │ │
│   │          │    │          │    │          │ │
│   │ Search   │    │ Do the   │    │ Distill  │ │
│   │ existing │    │ actual   │    │ insights │ │
│   │ cards    │    │ task     │    │ to cards │ │
│   └──────────┘    └──────────┘    └──────────┘ │
│        ▲                               │       │
│        └───────────────────────────────┘       │
│              Cards feed future recalls          │
└─────────────────────────────────────────────────┘
```

- **Recall** (task start) — search for relevant prior knowledge before starting work. Avoid repeating past mistakes.
- **Work** — do the actual task, informed by what you recalled.
- **Retro** (task end) — reflect on what you learned. Write cards for non-obvious insights only.

This loop is implemented by the `memex-recall` and `memex-retro` skills. The key insight: **retro is not just documentation — it's how you learn**. Writing in your own words forces deeper understanding than simply bookmarking a Stack Overflow link.

## Graph Health Maintenance

A knowledge graph degrades without maintenance. The `memex-organize` skill handles this, but here are the principles:

### Orphan Cards (0 inbound links)

An orphan is a card that nothing links to. It may be:
- **Genuinely standalone** — fine, leave it alone
- **Missing connections** — search for related cards and add contextual links

### Hub Cards (≥10 inbound links)

A hub card is referenced by many others. It may be:
- **Appropriately central** (e.g., a foundational concept) — fine
- **Too broad** — consider splitting into smaller, more atomic cards

### Contradictions

When two cards disagree, this is valuable signal — not a bug. The organize skill flags contradictions with `status: conflict` for human resolution. Don't auto-resolve conflicting beliefs.

### Staleness

If a card's information is outdated:
- **Update it** if the new info is a simple correction
- **Write a new card + archive the old one** if the new understanding is significantly different

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Write a card for every task | Only capture non-obvious insights |
| Copy-paste error messages as cards | Distill the root cause and fix |
| Create cards with no links | Always link to at least one related card |
| Use vague slugs like `notes` or `misc` | Use descriptive slugs: `postgres-connection-pool-sizing` |
| Write essay-length cards | Keep cards atomic — split if needed |
| Hoard tags (5+ per card) | Use 1–3 tags: one domain + one type |
| Link without explaining why | Every `[[link]]` needs a surrounding sentence |

## Quick Reference Card

For easy lookup, here's the complete format in one block:

```markdown
---
title: "Descriptive Noun Phrase ≤60 chars"
created: "2025-01-15"
source: "<auto>"
tags: [typescript, gotcha]
category: "backend"
---

<One atomic insight in your own words.>

<Context with [[wikilinks]] explaining relationships.>
```

**Slug**: `kebab-case-english-3-to-60-chars`
**Tags**: 1 domain + 1 type, lowercase
**Links**: in sentences, not in lists
**Length**: a few paragraphs, not an essay
