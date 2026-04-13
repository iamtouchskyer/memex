import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CardStore } from "../../src/lib/store.js";
import {
  readFlomoConfig,
  writeFlomoConfig,
  flomoConfigCommand,
  flomoPushCommand,
} from "../../src/commands/flomo.js";
import { stringifyFrontmatter } from "../../src/lib/parser.js";

let testDir: string;
let cardsDir: string;
let archiveDir: string;
let store: CardStore;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "memex-flomo-test-"));
  cardsDir = join(testDir, "cards");
  archiveDir = join(testDir, "archive");
  await mkdir(cardsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  store = new CardStore(cardsDir, archiveDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Config tests ────────────────────────────────────────────────────

describe("readFlomoConfig", () => {
  it("returns empty config when no .memexrc exists", async () => {
    const config = await readFlomoConfig(testDir);
    expect(config.webhookUrl).toBeUndefined();
  });

  it("reads flomoWebhookUrl from .memexrc", async () => {
    await writeFile(
      join(testDir, ".memexrc"),
      JSON.stringify({ flomoWebhookUrl: "https://flomoapp.com/iwh/abc/123/" }),
    );
    const config = await readFlomoConfig(testDir);
    expect(config.webhookUrl).toBe("https://flomoapp.com/iwh/abc/123/");
  });

  it("ignores non-string flomoWebhookUrl", async () => {
    await writeFile(join(testDir, ".memexrc"), JSON.stringify({ flomoWebhookUrl: 42 }));
    const config = await readFlomoConfig(testDir);
    expect(config.webhookUrl).toBeUndefined();
  });
});

describe("writeFlomoConfig", () => {
  it("writes webhook URL to .memexrc", async () => {
    const result = await writeFlomoConfig(testDir, "https://flomoapp.com/iwh/abc/123/");
    expect(result.success).toBe(true);
    const content = JSON.parse(await readFile(join(testDir, ".memexrc"), "utf-8"));
    expect(content.flomoWebhookUrl).toBe("https://flomoapp.com/iwh/abc/123/");
  });

  it("preserves existing config fields", async () => {
    await writeFile(join(testDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    await writeFlomoConfig(testDir, "https://flomoapp.com/iwh/abc/123/");
    const content = JSON.parse(await readFile(join(testDir, ".memexrc"), "utf-8"));
    expect(content.nestedSlugs).toBe(true);
    expect(content.flomoWebhookUrl).toBe("https://flomoapp.com/iwh/abc/123/");
  });

  it("rejects invalid webhook URL", async () => {
    const result = await writeFlomoConfig(testDir, "https://example.com/bad");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid flomo webhook URL");
  });
});

describe("flomoConfigCommand", () => {
  it("sets webhook URL", async () => {
    const result = await flomoConfigCommand(testDir, {
      setWebhook: "https://flomoapp.com/iwh/abc/123/",
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("configured");
  });

  it("shows configured URL", async () => {
    await writeFlomoConfig(testDir, "https://flomoapp.com/iwh/abc/123/");
    const result = await flomoConfigCommand(testDir, { show: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("https://flomoapp.com/iwh/abc/123/");
  });

  it("shows not configured when empty", async () => {
    const result = await flomoConfigCommand(testDir, { show: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("not configured");
  });
});

// ── Push tests ──────────────────────────────────────────────────────

function createMockFetch(statusCode = 200, body: unknown = { code: 0, message: "ok" }) {
  return vi.fn(async () => ({
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as unknown as typeof globalThis.fetch;
}

async function writeTestCard(slug: string, data: Record<string, unknown>, body: string) {
  const content = stringifyFrontmatter(body, data);
  await store.writeCard(slug, content);
}

describe("flomoPushCommand", () => {
  const webhookUrl = "https://flomoapp.com/iwh/abc/123/";

  beforeEach(async () => {
    await writeFile(join(testDir, ".memexrc"), JSON.stringify({ flomoWebhookUrl: webhookUrl }));
  });

  it("fails when webhook not configured", async () => {
    await writeFile(join(testDir, ".memexrc"), "{}");
    const result = await flomoPushCommand(store, testDir, "test-card", {});
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("not configured");
  });

  it("pushes a single card", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("test-card", { title: "Test", created: "2026-01-01", source: "retro" }, "Hello world");

    const result = await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("✓ test-card");
    expect(mockFetch).toHaveBeenCalledOnce();

    // Check that flomoPushedAt was written
    const card = await store.readCard("test-card");
    expect(card).toContain("flomoPushedAt");
  });

  it("dry-run skips already-pushed card (mirrors real behavior)", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("test-card", {
      title: "Test",
      created: "2026-01-01",
      source: "retro",
      flomoPushedAt: "2026-04-01",
    }, "Hello");

    const result = await flomoPushCommand(store, testDir, "test-card", { dryRun: true, fetchFn: mockFetch });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("⏭ test-card");
    expect(result.output).toContain("Already pushed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dry-run does not call fetch or modify card", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("test-card", { title: "Test", created: "2026-01-01", source: "retro" }, "Body");

    const result = await flomoPushCommand(store, testDir, "test-card", { dryRun: true, fetchFn: mockFetch });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("[dry-run]");
    expect(mockFetch).not.toHaveBeenCalled();

    // Card should NOT have flomoPushedAt
    const card = await store.readCard("test-card");
    expect(card).not.toContain("flomoPushedAt");
  });

  it("batch pushes with --source filter", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("card-a", { title: "A", created: "2026-01-01", source: "retro" }, "Body A");
    await writeTestCard("card-b", { title: "B", created: "2026-01-01", source: "import" }, "Body B");
    await writeTestCard("card-c", { title: "C", created: "2026-01-01", source: "retro" }, "Body C");

    const result = await flomoPushCommand(store, testDir, undefined, {
      all: true,
      source: "retro",
      fetchFn: mockFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("2 pushed");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("handles fetch errors gracefully", async () => {
    const mockFetch = createMockFetch(500, "Internal Server Error");
    await writeTestCard("test-card", { title: "Test", created: "2026-01-01", source: "retro" }, "Body");

    const result = await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("✗ test-card");
  });

  it("handles network errors gracefully", async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    await writeTestCard("test-card", { title: "Test", created: "2026-01-01", source: "retro" }, "Body");

    const result = await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("ECONNREFUSED");
  });

  it("includes tags in flomo content", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("test-card", {
      title: "Test",
      created: "2026-01-01",
      source: "retro",
      category: "engineering",
    }, "Body text");

    await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });

    const call = mockFetch.mock.calls[0] as unknown[];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.content).toContain("#engineering");
    expect(body.content).toContain("#memex/retro");
  });

  it("returns error for non-existent card", async () => {
    const mockFetch = createMockFetch();
    const result = await flomoPushCommand(store, testDir, "nonexistent", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Card not found");
  });

  it("handles array-type tags in card content", async () => {
    const mockFetch = createMockFetch();
    // Write card with raw frontmatter that has array tags
    const content = `---\ntitle: Test\ncreated: 2026-01-01\nsource: retro\ntags:\n  - foo\n  - bar\n---\nBody text`;
    await store.writeCard("array-tag-card", content);

    await flomoPushCommand(store, testDir, "array-tag-card", { fetchFn: mockFetch });

    const call = mockFetch.mock.calls[0] as unknown[];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.content).toContain("#foo");
    expect(body.content).toContain("#bar");
  });

  it("batch push with --tag filter uses exact match", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("card-eng", { title: "A", created: "2026-01-01", source: "retro", category: "engineering" }, "A");
    await writeTestCard("card-eng2", { title: "B", created: "2026-01-01", source: "retro", category: "engine" }, "B");

    const result = await flomoPushCommand(store, testDir, undefined, {
      all: true,
      tag: "engine",
      fetchFn: mockFetch,
    });
    expect(result.exitCode).toBe(0);
    // Should match only "engine", not "engineering"
    expect(result.output).toContain("1 pushed");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips already-pushed card in non-dry-run mode", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("test-card", {
      title: "Test",
      created: "2026-01-01",
      source: "retro",
      flomoPushedAt: "2026-04-01",
    }, "Hello");

    const result = await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("⏭ test-card");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles flomo API error code (HTTP 200 but code !== 0)", async () => {
    const mockFetch = createMockFetch(200, { code: -1, message: "Rate limit exceeded" });
    await writeTestCard("test-card", { title: "Test", created: "2026-01-01", source: "retro" }, "Body");

    const result = await flomoPushCommand(store, testDir, "test-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("✗ test-card");
    expect(result.output).toContain("Rate limit exceeded");

    // Card should NOT have flomoPushedAt since push failed
    const card = await store.readCard("test-card");
    expect(card).not.toContain("flomoPushedAt");
  });

  it("returns 0 pushed for empty batch filter result", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("card-a", { title: "A", created: "2026-01-01", source: "retro" }, "Body");

    const result = await flomoPushCommand(store, testDir, undefined, {
      all: true,
      source: "nonexistent-source",
      fetchFn: mockFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("No cards matched");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("anti-loopback: skips flomo-sourced cards on single push", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("flomo-card", { title: "From Flomo", created: "2026-01-01", source: "flomo" }, "Body");

    const result = await flomoPushCommand(store, testDir, "flomo-card", { fetchFn: mockFetch });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("anti-loopback");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("anti-loopback: excludes flomo-sourced cards from batch push", async () => {
    const mockFetch = createMockFetch();
    await writeTestCard("card-retro", { title: "Retro", created: "2026-01-01", source: "retro" }, "Body");
    await writeTestCard("card-flomo", { title: "Flomo", created: "2026-01-01", source: "flomo" }, "Body");

    const result = await flomoPushCommand(store, testDir, undefined, {
      all: true,
      fetchFn: mockFetch,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("1 pushed");
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ── Security: webhook URL validation ─────────────────────────────────

describe("webhook URL validation", () => {
  it("rejects path traversal in webhook URL", async () => {
    const result = await writeFlomoConfig(testDir, "https://flomoapp.com/iwh/../../api/admin");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid flomo webhook URL");
  });

  it("rejects non-flomoapp.com host", async () => {
    const result = await writeFlomoConfig(testDir, "https://evil.com/iwh/abc/123/");
    expect(result.success).toBe(false);
  });

  it("rejects HTTP (non-HTTPS)", async () => {
    const result = await writeFlomoConfig(testDir, "http://flomoapp.com/iwh/abc/123/");
    expect(result.success).toBe(false);
  });

  it("readFlomoConfig rejects tampered URL at read time", async () => {
    // Directly write a bad URL to .memexrc (simulating tampering)
    await writeFile(
      join(testDir, ".memexrc"),
      JSON.stringify({ flomoWebhookUrl: "https://evil.com/exfil" }),
    );
    const config = await readFlomoConfig(testDir);
    expect(config.webhookUrl).toBeUndefined();
  });
});
