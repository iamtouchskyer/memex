# Memex Extension for Pi

[Pi](https://github.com/mariozechner/pi-coding-agent) integration for memex — persistent Zettelkasten memory for AI coding agents.

Pi does not support MCP, so this extension wraps the `memex` CLI as native Pi custom tools.

## Install

**Step 1:** Install the memex CLI

```bash
npm install -g @touchskyer/memex
```

**Step 2:** Copy the extension to Pi's global extensions directory

```bash
mkdir -p ~/.pi/agent/extensions/memex
cp pi-extension/index.ts ~/.pi/agent/extensions/memex/index.ts
```

**Step 3:** Restart Pi or run `/reload`

That's it. The extension auto-discovers and loads on startup.

## What it does

### Custom Tools (callable by the LLM)

| Tool | Description |
|------|-------------|
| `memex_recall` | Load keyword index or search cards (call at task start) |
| `memex_retro` | Save an atomic insight card with [[wikilinks]] (call at task end) |
| `memex_search` | Full-text search memory cards |
| `memex_read` | Read a specific card by slug |
| `memex_write` | Write or update a card (frontmatter + body) |
| `memex_links` | Show link graph stats |
| `memex_archive` | Archive outdated cards |
| `memex_organize` | Analyze card network health |

### Session Hooks

- **`before_agent_start`** — Injects a reminder for the LLM to call `memex_recall` before starting work

### Slash Commands

| Command | Description |
|---------|-------------|
| `/memex` | Show memex status and card count |
| `/memex-serve` | Open the visual timeline UI |
| `/memex-sync` | Sync cards via git |

## How it works

The extension uses `node:child_process.execFile` to call the globally installed `memex` CLI. This avoids dependency management — the extension is a single TypeScript file with zero npm dependencies (only Pi built-in imports).

All cards are stored in `~/.memex/cards/` and shared with other memex clients (Claude Code, VS Code, Cursor, etc.).
