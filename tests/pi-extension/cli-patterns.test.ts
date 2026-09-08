/**
 * Integration tests for Pi extension CLI call patterns.
 *
 * The Pi extension wraps the memex CLI via child_process.spawn.
 * These tests verify the exact CLI commands the extension issues,
 * ensuring CLI behavior changes don't silently break the extension.
 *
 * Key patterns tested:
 *   memex_recall (no query):  memex read index → fallback memex search --list
 *   memex_search (no query):  memex search --list
 *   /memex command:           memex search --list
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../../dist/cli.js");

function run(
  args: string[],
  opts: { env: Record<string, string>; input?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: opts.env,
      stdio: opts.input !== undefined ? ["pipe", "pipe", "pipe"] : undefined,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    if (opts.input !== undefined && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

describe("Pi extension CLI patterns", () => {
  let tmpDir: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-pi-patterns-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    env = { ...process.env, MEMEX_HOME: tmpDir } as Record<string, string>;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // memex_recall with no query pattern:
  //   1. Try memex read index
  //   2. On failure, fall back to memex search --list
  // -----------------------------------------------------------------------

  it("memex_recall pattern: read index succeeds when index card exists", async () => {
    // Given an index card
    const indexCard = `---
title: Keyword Index
created: 2026-01-01
source: organize
---

## Auth
- [[jwt-migration]] — JWT token migration pattern
- [[oauth-flow]] — OAuth 2.0 authorization flow
`;
    await run(["write", "index"], { env, input: indexCard });

    // read index — should return the index content
    const { stdout: indexOut, exitCode: indexCode } = await run(["read", "index"], { env });
    expect(indexCode).toBe(0);
    expect(indexOut).toContain("Keyword Index");
    expect(indexOut).toContain("[[jwt-migration]]");
  });

  it("memex_recall pattern: falls back to --list when no index card", async () => {
    // Given cards but no index card
    const cardA = `---
title: Card Alpha
created: 2026-03-01
source: retro
---

Alpha content about authentication patterns.`;
    const cardB = `---
title: Card Beta
created: 2026-03-02
source: retro
---

Beta content about deployment strategies.`;
    await run(["write", "a"], { env, input: cardA });
    await run(["write", "b"], { env, input: cardB });

    // Step 1: read index — fails (no index card)
    const { exitCode: indexCode } = await run(["read", "index"], { env });
    expect(indexCode).toBe(1);

    // Step 2: fallback to search --list — should return all cards
    const { stdout: listOut, exitCode: listCode } = await run(["search", "--list"], { env });
    expect(listCode).toBe(0);
    expect(listOut).toContain("Card Alpha");
    expect(listOut).toContain("Card Beta");
    expect(listOut).not.toContain("No query provided");
  });

  it("memex_recall pattern: fresh memory returns clean message", async () => {
    // No cards at all — search --list returns empty output
    const { stdout: listOut } = await run(["search", "--list"], { env });
    // Should not contain guidance text — memex search --list should only show cards
    expect(listOut.trim()).toBe("");
  });

  // -----------------------------------------------------------------------
  // memex_search with no query pattern:
  //   Pi extension docs say: "Omit query to list all cards"
  //   → uses search --list
  // -----------------------------------------------------------------------

  it("memex_search pattern: search --list lists all cards", async () => {
    const c = `---
title: Search Test
created: 2026-04-01
source: retro
---

Content for search test.`;

    await run(["write", "search-test"], { env, input: c });

    const { stdout, exitCode } = await run(["search", "--list"], { env });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Search Test");
    expect(stdout).not.toContain("No query provided");
  });

  it("memex_search pattern: search with query works without --list", async () => {
    const c = `---
title: Auth Pattern
created: 2026-04-01
source: retro
---

JWT token rotation best practices.`;

    await run(["write", "auth-pattern"], { env, input: c });

    // search with query — should NOT use --list
    const { stdout, exitCode } = await run(["search", "JWT"], { env });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Auth Pattern");
    expect(stdout).not.toContain("No query provided");
  });

  // -----------------------------------------------------------------------
  // /memex command pattern:
  //   Shows card count by counting lines from search --list
  // -----------------------------------------------------------------------

  it("/memex command pattern: search --list returns card count", async () => {
    // Empty — 0 cards
    const { stdout: empty } = await run(["search", "--list"], { env });
    expect(empty.trim()).toBe("");

    // Add some cards
    await run(["write", "one"], { env, input: `---\ntitle: One\ncreated: 2026-03-01\nsource: retro\n---\nContent.` });
    await run(["write", "two"], { env, input: `---\ntitle: Two\ncreated: 2026-03-01\nsource: retro\n---\nContent.` });

    const { stdout: withCards } = await run(["search", "--list"], { env });
    const lines = withCards.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(2);
  });
});
