import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

describe("version consistency", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf-8"));

  it("package.json and plugin.json versions must match", () => {
    expect(plugin.version).toBe(pkg.version);
  });
});

describe("hooks ↔ skills consistency", () => {
  const hooksRaw = readFileSync(join(ROOT, "hooks/hooks.json"), "utf-8");
  const hooks = JSON.parse(hooksRaw);

  it("hooks.json is valid JSON", () => {
    expect(hooks).toBeDefined();
    expect(hooks.hooks.SessionStart).toBeInstanceOf(Array);
  });

  it("every skill referenced in hooks.json has a matching SKILL.md", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    // Extract skill names like `memex-recall`, `memex-retro` from backtick-quoted references
    const skillRefs = [...command.matchAll(/\\?`(memex-\w+)\\?`\s+skill/g)].map(m => m[1]);

    expect(skillRefs.length).toBeGreaterThan(0);

    for (const skill of skillRefs) {
      const skillPath = join(ROOT, "skills", skill, "SKILL.md");
      expect(existsSync(skillPath), `skill "${skill}" referenced in hooks.json but ${skillPath} does not exist`).toBe(true);
    }
  });

  it("hooks.json does NOT execute memex read index to inline content", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    // The command should not end with or contain a bare execution of "memex read index"
    // that would dump index content into system-reminder. Mentioning it in a fallback
    // instruction string (inside echo quotes) is fine.
    expect(command).not.toContain("### Index");
    // Should not have memex read index as a shell command (outside of echo strings)
    // The old pattern was: echo '...' && memex read index 2>/dev/null
    expect(command).not.toMatch(/&&\s*memex read index/);
    expect(command).not.toMatch(/;\s*memex read index/);
  });

  it("hooks.json references recall skill", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    expect(command).toContain("memex-recall");
  });

  it("hooks.json references retro skill", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    expect(command).toContain("memex-retro");
  });

  it("hooks.json uses CLAUDE_PLUGIN_ROOT instead of global memex binary", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    // Should reference the bundled CLI via CLAUDE_PLUGIN_ROOT
    expect(command).toContain("CLAUDE_PLUGIN_ROOT");
    expect(command).toContain("dist/cli.js");
    // Should NOT depend on a globally installed memex binary
    expect(command).not.toContain("command -v memex");
    expect(command).not.toMatch(/(?<!\$MEMEX_CLI )(?<!\$\{MEMEX_CLI\} )(?<!\")\bmemex sync\b/);
  });
});
