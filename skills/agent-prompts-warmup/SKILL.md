---
name: agent-prompts-warmup
description: "Audit and sync agent instruction files across all coding agent formats. FRE (first-run) checks scaffolding completeness; ongoing use keeps files in sync after edits."
triggers:
  - "agent prompts warmup"
  - "warmup agent prompts"
  - "audit agent docs"
  - "check agent instructions"
  - "update AGENTS.md"
  - "add agent target"
  - "sync agent docs"
---

# Agent Prompts Warmup

Agent instruction files ensure every coding agent (Claude Code, Codex, Copilot, Cursor, Gemini, Windsurf/Anti-Gravity) reads the same project rules when working on this codebase.

## Architecture

**Single source of truth**: `AGENTS.md`

All other files are **copies**, synced automatically:

| File | Agent(s) |
|------|----------|
| `AGENTS.md` | Codex CLI, GitHub Copilot (source of truth) |
| `CLAUDE.md` | Claude Code |
| `GEMINI.md` | Gemini CLI, Jules, Anti-Gravity |
| `.cursorrules` | Cursor |
| `.windsurfrules` | Windsurf / Anti-Gravity (legacy) |

**Sync mechanisms** (4 layers):
1. `scripts/postbuild.mjs` — `npm run build` copies AGENTS.md → all targets
2. `scripts/pre-commit` — git hook blocks commit if any file has drifted
3. `tests/integration/agent-docs-consistency.test.ts` — `npm test` fails on drift
4. CI — GitHub Actions runs `npm test` on push/PR to main

## When To Use This Skill

### 1. FRE Audit (first run in a new clone/worktree)

Run a full scaffolding check:

```
/agent-prompts-warmup audit
```

**Checklist to verify:**

- [ ] `AGENTS.md` exists and is non-empty
- [ ] All target files exist: `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`
- [ ] All targets are byte-identical to `AGENTS.md` (`diff -q`)
- [ ] `scripts/postbuild.mjs` has `cpSync` lines for all targets
- [ ] `tests/integration/agent-docs-consistency.test.ts` tests all targets
- [ ] `scripts/pre-commit` exists and checks all targets
- [ ] `.git/hooks/pre-commit` is installed and executable (run `npm run prepare` if not)
- [ ] `package.json` `files` field includes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs`
- [ ] `package.json` has `"prepare"` script that installs the hook

**If anything fails**: fix it immediately. The fix is usually `npm run build` (syncs files) or `npm run prepare` (installs hook).

### 2. After Editing Instructions

When the user edits `AGENTS.md` (or asks you to):

1. **Edit only `AGENTS.md`** — never edit the copies directly
2. Run sync: `node scripts/postbuild.mjs` (or `npm run build`)
3. Verify: `npm test -- tests/integration/agent-docs-consistency.test.ts`
4. Confirm all 5 files are identical

### 3. Adding a New Agent Target

When a new coding agent emerges that reads a different file:

1. **Identify the file name** the agent reads (e.g., `.devinrules`, `CLINE.md`)
2. Update `scripts/postbuild.mjs` — add `cpSync("AGENTS.md", "<new-file>");`
3. Update `tests/integration/agent-docs-consistency.test.ts` — add `expect(readFileSync("<new-file>", "utf-8")).toBe(agents);`
4. Update `scripts/pre-commit` — add the new file to the `TARGETS` array
5. Create the file: `cp AGENTS.md <new-file>`
6. If it should be npm-published: add to `package.json` `files` array
7. Run `npm test` to verify
8. Update this skill's mapping table above

## Troubleshooting

**"ERROR: CLAUDE.md has drifted from AGENTS.md"**
→ Someone edited a copy instead of AGENTS.md. Fix: `cp AGENTS.md CLAUDE.md` (or whichever file drifted). Then check if the edit in the copy should be applied — if so, edit AGENTS.md first, then `npm run build`.

**Pre-commit hook not running**
→ `npm run prepare` to reinstall. Or manually: `cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`

**CI failing on agent docs**
→ `npm run build && npm test` locally. If it passes locally but fails in CI, check that the build step runs before test in the workflow.

## Current Mapping Reference

```javascript
// scripts/postbuild.mjs
cpSync("AGENTS.md", "CLAUDE.md");       // Claude Code
cpSync("AGENTS.md", "GEMINI.md");       // Gemini CLI / Jules / Anti-Gravity
cpSync("AGENTS.md", ".cursorrules");    // Cursor
cpSync("AGENTS.md", ".windsurfrules"); // Windsurf / Anti-Gravity (legacy)
```
