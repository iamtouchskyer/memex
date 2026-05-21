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
  tmpDir = await mkdtemp(join(tmpdir(), "memex-ops-"));
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

describe("High-level operations", () => {
  afterEach(teardown);

  it("memex_recall returns index content", async () => {
    await setup({
      "index": "---\ntitle: Keyword Index\ncreated: 2026-01-01\nsource: organize\n---\n## Topic\n- [[card-a]] — desc",
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nSome content",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Keyword Index");
    expect(text).toContain("[[card-a]]");
  });

  it("memex_recall returns card list when no index", async () => {
    await setup({
      "card-a": "---\ntitle: Card A\ncreated: 2026-01-01\nsource: claude-code\n---\nContent",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("card-a");
  });

  it("memex_recall with query searches cards", async () => {
    await setup({
      "auth-card": "---\ntitle: Auth\ncreated: 2026-01-01\nsource: claude-code\n---\nJWT authentication",
    });
    const result = await client.callTool({ name: "memex_recall", arguments: { query: "JWT" } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("auth-card");
  });

  it("memex_recall rejects actual token queries", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { query: "sk-proj-abc123DEF456ghi789JKL012mno345PQR" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Sensitive input rejected");
    expect(text).not.toContain("sk-proj");
  });

  it("memex_recall warns but allows credential path queries", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { query: "gitee auth workflow ~/.claude/.env" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Warning:");
    expect(text).toContain("credential path");
  });

  it("memex_retro writes a card with auto-source", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: {
        slug: "my-insight",
        title: "My Insight",
        body: "Something I learned about [[related-topic]].",
        category: "architecture",
      },
    });
    expect(result.isError).toBeFalsy();

    const readResult = await client.callTool({ name: "memex_read", arguments: { slug: "my-insight" } });
    const text = (readResult.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("My Insight");
    expect(text).toContain("architecture");
    expect(text).toContain("test-client");
  });

  it("memex_retro rejects actual token values", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: {
        slug: "secret",
        title: "Secret",
        body: "sk-proj-abc123DEF456ghi789JKL012mno345PQR",
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).not.toContain("sk-proj");
  });

  it("memex_retro returns upsell when sync not configured", async () => {
    await setup();
    const result = await client.callTool({
      name: "memex_retro",
      arguments: { slug: "test", title: "Test", body: "Content" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("memex sync --init");
  });

  it("memex_organize returns link stats", async () => {
    await setup({
      "a": "---\ntitle: A\ncreated: 2026-01-01\nsource: claude-code\n---\nSee [[b]]",
      "b": "---\ntitle: B\ncreated: 2026-01-01\nsource: claude-code\n---\nStandalone",
    });
    const result = await client.callTool({ name: "memex_organize", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("a");
    expect(text).toContain("b");
  });

  it("memex_recall truncates large index and shows summary", async () => {
    let indexBody = "---\ntitle: Keyword Index\ncreated: 2026-01-01\nsource: organize\n---\n";
    indexBody += "## Section A\n";
    for (let i = 0; i < 100; i++) {
      indexBody += `- [[card-a-${i}]] — description of card a ${i}\n`;
    }
    indexBody += "## Section B\n";
    for (let i = 0; i < 100; i++) {
      indexBody += `- [[card-b-${i}]] — description of card b ${i}\n`;
    }
    await setup({ index: indexBody });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Index summary");
    expect(text).toContain("Section A");
    expect(text).toContain("Section B");
    expect(text).toContain("entries");
    expect(text).toContain("memex search");
    expect(text.length).toBeLessThan(indexBody.length);
  });

  it("memex_recall returns small index in full", async () => {
    const smallIndex = "---\ntitle: Keyword Index\ncreated: 2026-01-01\nsource: organize\n---\n## Topic\n- [[card-a]] — desc";
    await setup({ index: smallIndex, "card-a": "---\ntitle: A\n---\ncontent" });
    const result = await client.callTool({ name: "memex_recall", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).not.toContain("Index summary");
    expect(text).toContain("[[card-a]]");
  });

  it("memex_recall with category filter returns matching cards", async () => {
    await setup({
      "auth-card": "---\ntitle: Auth Flow\ncreated: 2026-01-01\ncategory: security\nsource: claude-code\n---\nJWT authentication",
      "deploy-card": "---\ntitle: Deploy Guide\ncreated: 2026-01-01\ncategory: devops\nsource: claude-code\n---\nCI/CD pipeline",
    });
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { category: "security" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("auth-card");
    expect(text).not.toContain("deploy-card");
  });

  it("memex_recall with tag filter returns matching cards", async () => {
    await setup({
      "tagged-card": "---\ntitle: Tagged\ncreated: 2026-01-01\ntags: [rust, performance]\nsource: claude-code\n---\nContent",
      "untagged-card": "---\ntitle: Untagged\ncreated: 2026-01-01\nsource: claude-code\n---\nOther content",
    });
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { tag: "rust" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("tagged-card");
    expect(text).not.toContain("untagged-card");
  });

  it("memex_recall with query + filter combines both", async () => {
    await setup({
      "sec-jwt": "---\ntitle: JWT Auth\ncreated: 2026-01-01\ncategory: security\nsource: claude-code\n---\nJWT token rotation",
      "arch-jwt": "---\ntitle: JWT Architecture\ncreated: 2026-01-01\ncategory: architecture\nsource: claude-code\n---\nJWT signing keys",
    });
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { query: "JWT", category: "security" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("sec-jwt");
    expect(text).not.toContain("arch-jwt");
  });

  it("memex_recall with since filter returns recent cards only", async () => {
    await setup({
      "old-card": "---\ntitle: Old\ncreated: 2025-01-01\nsource: claude-code\n---\nOld content",
      "new-card": "---\ntitle: New\ncreated: 2026-05-01\nsource: claude-code\n---\nNew content",
    });
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { since: "2026-01-01" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("new-card");
    expect(text).not.toContain("old-card");
  });

  it("memex_recall with before filter returns older cards only", async () => {
    await setup({
      "old-card": "---\ntitle: Old\ncreated: 2025-06-01\nsource: claude-code\n---\nOld content",
      "new-card": "---\ntitle: New\ncreated: 2026-05-01\nsource: claude-code\n---\nNew content",
    });
    const result = await client.callTool({
      name: "memex_recall",
      arguments: { before: "2026-01-01" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("old-card");
    expect(text).not.toContain("new-card");
  });

  it("flomo_import_parse rejects non-HTML files", async () => {
    await setup();
    const result = await client.callTool({
      name: "flomo_import_parse",
      arguments: { file_path: "/tmp/data.json" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Only .html and .htm files");
  });

  it("flomo_import_parse rejects path with null bytes", async () => {
    await setup();
    const result = await client.callTool({
      name: "flomo_import_parse",
      arguments: { file_path: "/tmp/data\0.html" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Invalid file path");
  });

  it("flomo_import_parse rejects non-existent file", async () => {
    await setup();
    const result = await client.callTool({
      name: "flomo_import_parse",
      arguments: { file_path: "/tmp/nonexistent-memex-test.html" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Cannot read file");
  });

  it("has all expected high-level tools", async () => {
    await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("memex_recall");
    expect(names).toContain("memex_retro");
    expect(names).toContain("memex_organize");
    expect(names).toContain("memex_pull");
    expect(names).toContain("memex_push");
    expect(names).not.toContain("memex_init");
  });
});
