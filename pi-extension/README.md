# Memex Extension for Pi

[Pi](https://github.com/mariozechner/pi-coding-agent) integration for memex — persistent Zettelkasten memory for AI coding agents.

Pi does not support MCP, so this extension wraps the `memex` CLI as native Pi custom tools.

## Install

```bash
npm install -g @touchskyer/memex   # install the CLI
pi install npm:@touchskyer/memex   # install the Pi extension
```

Or install from git:

```bash
pi install git:github.com/iamtouchskyer/memex
```

That's it. Pi auto-discovers the extension on startup. Run `/reload` if Pi is already running.

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

### Session Lifecycle Hooks

| Event | Behavior |
|-------|----------|
| `before_agent_start` | Injects a reminder for the LLM to call `memex_recall` before starting work (first turn only) |
| `agent_end` | Injects a reminder for the LLM to call `memex_retro` if it hasn't done so yet (delivered on next turn) |
| `session_compact` | Resets recall state so the recall reminder re-injects after compaction |
| `resources_discover` | Exposes bundled skills (`memex-recall`, `memex-retro`, `memex-organize`, `memex-best-practices`, `memex-sync`) |

#### How the recall/retro lifecycle works

```
session_start
  └─ recallDone = false, retroDone = false

user sends first prompt
  └─ before_agent_start → injects recall reminder (hidden)
      └─ LLM calls memex_recall → recallDone = true
          └─ LLM works on the task...
              └─ agent_end → sees recallDone && !retroDone
                  └─ queues retro reminder for next turn (nextTurn delivery)

user sends next prompt (or same turn continues)
  └─ LLM sees retro reminder → calls memex_retro
      └─ retroDone = true → no more reminders

compaction happens mid-session
  └─ session_compact → recallDone = false
      └─ next before_agent_start → re-injects recall reminder
```

### Skills (available via `/skill:name`)

The extension registers bundled skills with Pi's resource discovery:

| Skill | Description |
|-------|-------------|
| `/skill:memex-recall` | Detailed recall workflow: read index → search → follow links |
| `/skill:memex-retro` | Detailed retro workflow: distill → dedup → write atomic cards |
| `/skill:memex-organize` | Network maintenance: detect orphans, hubs, contradictions |
| `/skill:memex-best-practices` | Card quality guide: naming, tagging, linking conventions |
| `/skill:memex-sync` | Git sync workflow for sharing cards across machines |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/memex` | Show memex status and card count |
| `/memex-serve` | Open the visual timeline UI |
| `/memex-sync` | Sync cards via git |

## How it works

The extension uses `node:child_process.spawn` to call the globally installed `memex` CLI. This avoids dependency management — the extension is a single TypeScript file with zero npm dependencies (only Pi built-in imports).

All cards are stored in `~/.memex/cards/` and shared with other memex clients (Claude Code, VS Code, Cursor, etc.).
