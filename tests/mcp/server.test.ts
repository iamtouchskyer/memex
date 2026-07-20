import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemexServer } from "../../src/mcp/server.js";
import { CardStore } from "../../src/lib/store.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let client: Client;

async function setup(cards: Record<string, string> = {}) {
  tmpDir = await mkdtemp(join(tmpdir(), "memex-mcp-"));
  const cardsDir = join(tmpDir, "cards");
  const archiveDir = join(tmpDir, "archive");
  await mkdir(cardsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  for (const [slug, content] of Object.entries(cards)) {
    await writeFile(join(cardsDir, `${slug}.md`), content);
  }

  const store = new CardStore(cardsDir, archiveDir);
  const server = createMemexServer(store, tmpDir);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
}

async function teardown() {
  await client.close();
  await rm(tmpDir, { recursive: true });
}

describe("MCP server", () => {
  afterEach(teardown);

  it("lists all 13 tools", async () => {
    await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "flomo_import_parse",
      "flomo_push",
      "memex_archive",
      "memex_link",
      "memex_links",
      "memex_organize",
      "memex_pull",
      "memex_push",
      "memex_read",
      "memex_recall",
      "memex_retro",
      "memex_search",
      "memex_write",
    ]);
  });

  it("memex_search shows guidance when no query", async () => {
    await setup({
      "test-card": "---\ntitle: Test Card\ncreated: 2026-01-01\nsource: retro\n---\nHello world",
    });
    const result = await client.callTool({ name: "memex_search", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("No query provided");
    expect(text).toContain("memex read index");
  });

  it("memex_search lists all cards when no query with list:true", async () => {
    await setup({
      "test-card": "---\ntitle: Test Card\ncreated: 2026-01-01\nsource: retro\n---\nHello world",
    });
    const result = await client.callTool({ name: "memex_search", arguments: { list: true } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("test-card");
    expect(text).toContain("Test Card");
  });

  it("memex_search with query finds matching cards", async () => {
    await setup({
      "alpha": "---\ntitle: Alpha\ncreated: 2026-01-01\nsource: retro\n---\nThis is about authentication",
      "beta": "---\ntitle: Beta\ncreated: 2026-01-01\nsource: retro\n---\nThis is about databases",
    });
    const result = await client.callTool({ name: "memex_search", arguments: { query: "authentication" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("alpha");
    expect(text).not.toContain("beta");
  });

  it("memex_search rejects actual token queries", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_search",
      arguments: { query: "sk-proj-abc123DEF456ghi789JKL012mno345PQR" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Sensitive input rejected");
    expect(text).not.toContain("sk-proj");
  });

  it("memex_search allows token architecture language", async () => {
    await setup({
      "auth": "---\ntitle: Auth\ncreated: 2026-01-01\nsource: retro\n---\nBearer token rotation",
    });
    const result = await client.callTool({
      name: "memex_search",
      arguments: { query: "Bearer token" },
    });
    expect(result.isError).toBeFalsy();
  });

  it("memex_read returns card content", async () => {
    await setup({
      "my-card": "---\ntitle: My Card\ncreated: 2026-01-01\nsource: retro\n---\nCard body here",
    });
    const result = await client.callTool({ name: "memex_read", arguments: { slug: "my-card" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("My Card");
    expect(text).toContain("Card body here");
  });

  it("memex_read returns error for missing card", async () => {
    await setup();
    const result = await client.callTool({ name: "memex_read", arguments: { slug: "nonexistent" } });
    expect(result.isError).toBe(true);
  });

  it("memex_write creates a new card", async () => {
    await setup();
    const content = "---\ntitle: New Card\ncreated: 2026-01-01\nsource: retro\n---\nNew content";
    const writeResult = await client.callTool({ name: "memex_write", arguments: { slug: "new-card", content } });
    expect(writeResult.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "new-card" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("New Card");
  });

  it("memex_write rejects actual token values", async () => {
    await setup();
    const content = "---\ntitle: Secret\ncreated: 2026-01-01\nsource: retro\n---\nsk-proj-abc123DEF456ghi789JKL012mno345PQR";
    const result = await client.callTool({ name: "memex_write", arguments: { slug: "secret", content } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).not.toContain("sk-proj");
  });

  it("memex_write masks tokenized URLs", async () => {
    await setup();
    const content = "---\ntitle: Remote\ncreated: 2026-01-01\nsource: retro\n---\nhttps://user:secret1234567890@github.com/org/repo";
    const writeResult = await client.callTool({ name: "memex_write", arguments: { slug: "remote", content } });
    expect(writeResult.isError).toBeFalsy();
    const writeText = (writeResult.content as Array<{ text: string }>)[0].text;
    expect(writeText).toContain("Warning:");

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "remote" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("https://user:<redacted>@github.com/org/repo");
    expect(text).not.toContain("secret1234567890");
  });

  it("memex_write returns error for invalid frontmatter", async () => {
    await setup();
    const result = await client.callTool({ name: "memex_write", arguments: { slug: "bad", content: "no frontmatter" } });
    expect(result.isError).toBe(true);
  });

  it("memex_links returns graph stats", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: retro\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: retro\n---\nStandalone",
    });
    const result = await client.callTool({ name: "memex_links", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("a");
    expect(text).toContain("b");
  });

  it("memex_archive moves card", async () => {
    await setup({
      "old-card": "---\ntitle: Old\ncreated: 2026-01-01\nsource: retro\n---\nOld content",
    });
    const archiveResult = await client.callTool({ name: "memex_archive", arguments: { slug: "old-card" } });
    expect(archiveResult.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "old-card" } });
    expect(readResult.isError).toBe(true);
  });

  it("memex_search clamps limit to max 50", async () => {
    const cards: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      cards[`card-${i}`] = `---\ntitle: Card ${i}\n---\nContent about topic ${i}`;
    }
    await setup(cards);
    const result = await client.callTool({
      name: "memex_search",
      arguments: { limit: 100, list: true },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    // With 60 cards and limit clamped to 50, should show truncation
    expect(text).toContain("50 of 60");
    expect(text).toContain("cards shown");
  });

  it("memex_link creates a relationship link", async () => {
    await setup({
      "react-hooks": "---\ntitle: React Hooks\ncreated: 2024-01-01\n---\nSome content about hooks",
      "state-management": "---\ntitle: State Management\ncreated: 2024-01-01\n---\nSome content about state",
    });
    const result = await client.callTool({
      name: "memex_link",
      arguments: { from: "react-hooks", to: "state-management", context: "React hooks provide a foundation for" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Linked react-hooks → state-management");
  });

  it("memex_link rejects missing context", async () => {
    await setup({
      "some-card": "---\ntitle: Some Card\ncreated: 2024-01-01\n---\nContent",
    });
    const result = await client.callTool({
      name: "memex_link",
      arguments: { from: "some-card", to: "other-card", context: "" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("relationship context is required");
  });

  it("memex_link detects already-linked cards", async () => {
    await setup({
      "source-card": "---\ntitle: Source Card\ncreated: 2024-01-01\n---\nAlready links to [[target-card]] here",
      "target-card": "---\ntitle: Target Card\ncreated: 2024-01-01\n---\nTarget content",
    });
    const result = await client.callTool({
      name: "memex_link",
      arguments: { from: "source-card", to: "target-card", context: "They relate because" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("already links to");
  });

});
