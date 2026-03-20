# memex

Persistent memory for AI coding agents. Your agent remembers what it learned across sessions.

![memex timeline view](screenshot.png)

## What it does

Every time your AI agent finishes a task, it saves insights as atomic knowledge cards with `[[bidirectional links]]`. Next session, it recalls relevant cards before starting work — building on what it already knows instead of starting from scratch.

```
Session 1: Agent fixes auth bug → saves insight about JWT revocation
Session 2: Agent works on session management → recalls JWT card, builds on prior knowledge
Session 3: Agent organizes card network → detects orphans, rebuilds keyword index
```

No vector database, no embeddings — just markdown files your agent (and you) can read.

## Install

### Any editor (one command)

```bash
npx add-mcp @touchskyer/memex -- mcp
```

Supports Claude Code, Cursor, Codex, VS Code, Gemini CLI, Goose, Zed, and more. Auto-detects your editor.

### Claude Code (best experience)

```bash
/plugin marketplace add iamtouchskyer/memex
/plugin install memex@memex
```

Gives you auto-recall on session start, 3 slash commands (`/memex-recall`, `/memex-retro`, `/memex-organize`), and a SessionStart hook that injects your knowledge index.

### VS Code / GitHub Copilot

Search "memex" in the [MCP Registry](https://registry.modelcontextprotocol.io) and click **Install in VS Code**, or run:

```bash
code --add-mcp '{"name":"memex","command":"npx","args":["-y","@touchskyer/memex","mcp"]}'
```

### Cursor

[**One-click install**](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB0b3VjaHNreWVyL21lbWV4IiwibWNwIl19)

Or via command:

```bash
codex mcp add memex -- npx -y @touchskyer/memex mcp
```

### Codex

```bash
codex mcp add memex -- npx -y @touchskyer/memex mcp
```

### Windsurf / Other MCP clients

Add memex as an MCP server with command `npx` and args `["-y", "@touchskyer/memex", "mcp"]`.

### Add agent instructions (recommended for MCP users)

After installing the MCP server, run this in your project directory:

```bash
npx @touchskyer/memex init
```

This adds a memex section to your `AGENTS.md` that teaches the agent when to recall and retro. Supported by Cursor, Copilot, Codex, and Windsurf.

## Upgrade

### Claude Code

```bash
npm update -g @touchskyer/memex
```

Plugin skills and hooks update automatically from the marketplace.

### VS Code / Copilot / Cursor / Windsurf

If you installed via `npx` (recommended), you're always on the latest — `npx -y` fetches the newest version automatically.

To force a cache refresh:

```bash
npx -y @touchskyer/memex@latest mcp
```

### Codex / global install

```bash
npm update -g @touchskyer/memex
```

## Browse your memory

```bash
memex serve
```

Opens a visual timeline of all your cards at `localhost:3939`.

## Sync across devices

```bash
memex sync --init git@github.com:you/memex-cards.git
memex sync --auto on
```

Cards are plain markdown — git handles merging and history.

## CLI reference

```bash
memex search [query]          # search cards, or list all
memex read <slug>             # read a card
memex write <slug>            # write a card (stdin)
memex links [slug]            # link graph stats
memex archive <slug>          # archive a card
memex serve                   # visual timeline UI
memex sync                    # sync via git
memex mcp                     # start MCP server (stdio)
memex init                    # add memex section to AGENTS.md
```

## How it works

Based on Niklas Luhmann's Zettelkasten method — the system behind 70 books from 90,000 handwritten cards:

- **Atomic notes** — one idea per card
- **Own words** — forces understanding (the Feynman method)
- **Links in context** — "this relates to [[X]] because..." not just tags
- **Keyword index** — curated entry points to the card network

Cards are stored as markdown in `~/.memex/cards/`. Open them in Obsidian, edit with vim, grep from terminal. Your memory is never locked in.

## License

MIT
