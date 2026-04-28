import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { serveCommand } from "../../src/commands/serve.js";

function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

describe("serve API", () => {
  let tmpDir: string;
  let port: number;
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-serve-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });

    await writeFile(
      join(cardsDir, "test-card.md"),
      "---\ntitle: Test Card\ncreated: 2025-01-15\nsource: retro\n---\nThis is a test card with [[linked-card]]."
    );
    await writeFile(
      join(cardsDir, "linked-card.md"),
      "---\ntitle: Linked Card\ncreated: 2025-01-14\nsource: manual\n---\nThis card is linked from test-card."
    );

    await writeFile(
      join(cardsDir, "index.md"),
      "---\ntitle: Index\ncreated: 2020-01-01\n---\nIndex card"
    );

    process.env.MEMEX_HOME = tmpDir;
    process.env.MEMEX_NO_OPEN = "1";

    port = 10000 + Math.floor(Math.random() * 50000);
    baseUrl = `http://localhost:${port}`;

    server = await serveCommand(port);
  }, 10000);

  afterAll(async () => {
    server?.close();
    delete process.env.MEMEX_HOME;
    delete process.env.MEMEX_NO_OPEN;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET / returns HTML", async () => {
    const res = await get(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("memex");
  });

  it("GET /api/cards returns all cards", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    expect(res.status).toBe(200);
    const cards = JSON.parse(res.body);
    expect(cards).toHaveLength(3);
    const slugs = cards.map((c: any) => c.slug).sort();
    expect(slugs).toEqual(["index", "linked-card", "test-card"]);
  });

  it("GET /api/cards/:slug returns card content", async () => {
    const res = await get(`${baseUrl}/api/cards/test-card`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Test Card");
    expect(res.body).toContain("[[linked-card]]");
  });

  it("GET /api/cards/nonexistent returns 404", async () => {
    const res = await get(`${baseUrl}/api/cards/nonexistent`);
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Not found");
  });

  it("GET /api/links returns link stats", async () => {
    const res = await get(`${baseUrl}/api/links`);
    expect(res.status).toBe(200);
    const stats = JSON.parse(res.body);
    expect(stats).toHaveLength(3);
    const testCard = stats.find((s: any) => s.slug === "test-card");
    expect(testCard.outbound).toBe(1);
  });

  it("GET /api/search?q=test returns filtered results", async () => {
    const res = await get(`${baseUrl}/api/search?q=test`);
    expect(res.status).toBe(200);
    const results = JSON.parse(res.body);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r: any) => r.slug === "test-card")).toBe(true);
  });

  it("GET /unknown returns 404", async () => {
    const res = await get(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  it("GET /api/cards sorts index card first", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    const cards = JSON.parse(res.body);
    expect(cards[0].slug).toBe("index");
  });

  it("GET /api/cards sorts remaining cards by created desc", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    const cards = JSON.parse(res.body);
    // Skip index card (first), rest should be sorted by created descending
    const nonIndex = cards.filter((c: any) => c.slug !== "index");
    for (let i = 1; i < nonIndex.length; i++) {
      expect(nonIndex[i - 1].created >= nonIndex[i].created).toBe(true);
    }
  });

  it("GET /api/cards returns correct fields", async () => {
    const res = await get(`${baseUrl}/api/cards`);
    const cards = JSON.parse(res.body);
    const testCard = cards.find((c: any) => c.slug === "test-card");
    expect(testCard).toBeDefined();
    expect(testCard.title).toBe("Test Card");
    expect(testCard.created).toBe("2025-01-15");
    expect(testCard.source).toBe("retro");
    expect(testCard.links).toEqual(["linked-card"]);
    expect(testCard.firstLine).toBeTruthy();
  });

  it("GET / includes sync banner when not synced", async () => {
    const res = await get(`${baseUrl}/`);
    expect(res.body).toContain("sync-banner");
    expect(res.body).toContain("memex sync --init");
  });

  it("GET /api/search with empty query returns results", async () => {
    const res = await get(`${baseUrl}/api/search?q=`);
    expect(res.status).toBe(200);
    const results = JSON.parse(res.body);
    expect(results.length).toBeGreaterThan(0);
  });

  it("GET /api/search with no match returns empty array", async () => {
    const res = await get(`${baseUrl}/api/search?q=zzzznonexistent99999`);
    expect(res.status).toBe(200);
    const results = JSON.parse(res.body);
    expect(results).toEqual([]);
  });

  it("GET /api/links returns correct inbound count", async () => {
    const res = await get(`${baseUrl}/api/links`);
    const stats = JSON.parse(res.body);
    const linked = stats.find((s: any) => s.slug === "linked-card");
    expect(linked).toBeDefined();
    expect(linked.inbound).toBe(1); // referenced by test-card
  });

  it("GET /api/cards/:slug with encoded slug works", async () => {
    const res = await get(`${baseUrl}/api/cards/${encodeURIComponent("test-card")}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Test Card");
  });
});

describe("serve --local flag", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-serve-local-test-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await writeFile(
      join(tmpDir, "cards", "card.md"),
      "---\ntitle: Card\ncreated: 2025-01-15\n---\nbody"
    );
    // Simulate a configured sync remote — without --local, serve would redirect.
    await writeFile(
      join(tmpDir, ".sync.json"),
      JSON.stringify({ remote: "git@github.com:user/memex-cards.git", adapter: "git", auto: false })
    );

    process.env.MEMEX_HOME = tmpDir;
    process.env.MEMEX_NO_OPEN = "1";
  });

  afterAll(async () => {
    delete process.env.MEMEX_HOME;
    delete process.env.MEMEX_NO_OPEN;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null (redirects) when sync configured and --local not passed", async () => {
    const result = await serveCommand(0);
    expect(result).toBeNull();
  });

  it("starts local server when --local passed even with sync configured", async () => {
    const port = 10000 + Math.floor(Math.random() * 50000);
    const server = await serveCommand(port, { local: true });
    try {
      expect(server).not.toBeNull();
      const res = await get(`http://localhost:${port}/api/cards`);
      expect(res.status).toBe(200);
      const cards = JSON.parse(res.body);
      expect(cards).toHaveLength(1);
      expect(cards[0].slug).toBe("card");
    } finally {
      server?.close();
    }
  });

  it("suppresses sync banner in --local mode when sync is configured", async () => {
    const port = 10000 + Math.floor(Math.random() * 50000);
    const server = await serveCommand(port, { local: true });
    try {
      const res = await get(`http://localhost:${port}/`);
      expect(res.body).not.toContain("sync-banner");
    } finally {
      server?.close();
    }
  });
});
