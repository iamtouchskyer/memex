# Memex - Agent Memory

Persistent Zettelkasten memory for AI coding agents.

## What it does

Memex gives your AI coding agent (GitHub Copilot, Cursor, Claude Code) a persistent memory that survives across sessions. Every insight from your AI conversations gets distilled into atomic knowledge cards with bidirectional links.

## How it works

This extension registers a **MCP (Model Context Protocol) server** that provides your AI agent with tools to:

- **`memex_search`** — Search your knowledge cards by keyword
- **`memex_read`** — Read a card's full content
- **`memex_write`** — Write a new card or update an existing one

Cards are stored locally in `~/.memex/cards/` as plain Markdown files.

## Requirements

- Node.js 18+
- VS Code 1.100+
- A MCP-compatible AI client (GitHub Copilot, Cursor, etc.)

## Quick Start

1. Install this extension
2. The MCP server starts automatically
3. Ask your AI agent to "remember" something — it will use memex tools

## Sync

Sync your cards across devices with `memex sync`:

```bash
npx @touchskyer/memex sync --init
```

## Links

- [GitHub](https://github.com/iamtouchskyer/memex)
- [npm](https://www.npmjs.com/package/@touchskyer/memex)
