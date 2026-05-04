import { cpSync } from "fs";
import { join } from "path";

cpSync(join("src", "commands", "serve-ui.html"), join("dist", "commands", "serve-ui.html"));
cpSync(join("src", "share-card"), join("dist", "share-card"), { recursive: true });

// Keep all agent instruction files in sync with AGENTS.md (single source of truth)
//   AGENTS.md    → Codex CLI, GitHub Copilot
//   CLAUDE.md    → Claude Code
//   GEMINI.md    → Gemini CLI, Jules, Anti-Gravity (Google)
//   .cursorrules → Cursor
//   .windsurfrules → Windsurf / Anti-Gravity (legacy)
cpSync("AGENTS.md", "CLAUDE.md");
cpSync("AGENTS.md", "GEMINI.md");
cpSync("AGENTS.md", ".cursorrules");
cpSync("AGENTS.md", ".windsurfrules");
