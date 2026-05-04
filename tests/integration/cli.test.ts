import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exec as execCb } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../../dist/cli.js");

function run(
  cmd: string,
  opts: { env: Record<string, string>; input?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execCb(cmd, { env: opts.env }, (err, stdout, stderr) => {
      if (err) {
        const e: any = err;
        e.stdout = stdout;
        e.stderr = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
    if (opts.input !== undefined) {
      child.stdin!.write(opts.input);
      child.stdin!.end();
    }
  });
}

describe("CLI integration", () => {
  let tmpDir: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-cli-test-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    env = { ...process.env, MEMEX_HOME: tmpDir } as Record<string, string>;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("write + read roundtrip", async () => {
    const card = `---
title: Test Card
created: 2026-03-18
source: manual
---

Hello world.`;

    await run(`node ${CLI_PATH} write test-card`, { env, input: card });

    const { stdout } = await run(`node ${CLI_PATH} read test-card`, { env });
    expect(stdout).toContain("Test Card");
    expect(stdout).toContain("Hello world.");
  });

  it("search with no args lists all", async () => {
    await writeFile(
      join(tmpDir, "cards", "a.md"),
      "---\ntitle: Alpha\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nContent."
    );
    const { stdout } = await run(`node ${CLI_PATH} search`, { env });
    expect(stdout).toContain("Alpha");
  });

  it("read nonexistent exits 1", async () => {
    try {
      await run(`node ${CLI_PATH} read nope`, { env });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.stderr).toContain("Card not found");
    }
  });

  it("reads nested slug when nestedSlugs is enabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const card = `---
title: Nested Card
created: 2026-03-18
source: manual
---

Nested content.`;

    await run(`node ${CLI_PATH} write sub/test-card`, { env, input: card });

    const { stdout } = await run(`node ${CLI_PATH} read sub/test-card`, { env });
    expect(stdout).toContain("Nested Card");
    expect(stdout).toContain("Nested content.");
  });

  it("lists nested cards when nestedSlugs is enabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    await mkdir(join(tmpDir, "cards", "sub"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "sub", "nested.md"),
      "---\ntitle: Nested\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nContent."
    );
    const { stdout } = await run(`node ${CLI_PATH} search`, { env });
    expect(stdout).toContain("sub/nested");
  });

  it("read --nested overrides config to use nested slugs", async () => {
    // No .memexrc — nestedSlugs defaults to false
    await mkdir(join(tmpDir, "cards", "deep"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "deep", "card.md"),
      "---\ntitle: Deep Card\ncreated: 2026-03-18\nsource: manual\n---\nDeep content."
    );

    // Without --nested, read "deep/card" fails (basename slug = "card")
    try {
      await run(`node ${CLI_PATH} read deep/card`, { env });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.stderr).toContain("Card not found");
    }

    // With --nested, read "deep/card" succeeds
    const { stdout } = await run(`node ${CLI_PATH} read --nested deep/card`, { env });
    expect(stdout).toContain("Deep Card");
    expect(stdout).toContain("Deep content.");
  });

  it("search --nested shows full paths without config", async () => {
    // No .memexrc — nestedSlugs defaults to false
    await mkdir(join(tmpDir, "cards", "sub"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "sub", "item.md"),
      "---\ntitle: Sub Item\ncreated: 2026-03-18\nmodified: 2026-03-18\nsource: manual\n---\nSub content."
    );

    // Without --nested, search shows basename only
    const { stdout: flat } = await run(`node ${CLI_PATH} search`, { env });
    expect(flat).not.toContain("sub/item");

    // With --nested, search shows full path slug
    const { stdout: nested } = await run(`node ${CLI_PATH} search --nested`, { env });
    expect(nested).toContain("sub/item");
  });
});
