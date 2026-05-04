import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// All agent instruction files must be byte-identical to AGENTS.md (single source of truth).
// .cursorrules and .windsurfrules are repo-local only — intentionally NOT published to npm.
const targets = [
  ["CLAUDE.md", "Claude Code"],
  ["GEMINI.md", "Gemini CLI / Jules / Anti-Gravity"],
  [".cursorrules", "Cursor"],
  [".windsurfrules", "Windsurf / Anti-Gravity (legacy)"],
] as const;

describe("agent docs consistency", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");

  it.each(targets)("%s (%s) must be identical to AGENTS.md", (file) => {
    expect(readFileSync(join(ROOT, file), "utf-8")).toBe(agents);
  });
});
