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

  it("lists all 12 tools", async () => {
    await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "flomo_import_parse",
      "flomo_push",
      "memex_archive",
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

  it("memex_search lists all cards when no query", async () => {
    await setup({
      "test-card": "---\ntitle: Test Card\ncreated: 2026-01-01\nsource: retro\n---\nHello world",
    });
    const result = await client.callTool({ name: "memex_search", arguments: {} });
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

});
