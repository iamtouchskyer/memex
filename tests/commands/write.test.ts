import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommand } from "../../src/commands/write.js";
import { CardStore } from "../../src/lib/store.js";
import { parseFrontmatter } from "../../src/lib/parser.js";

describe("writeCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    store = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid card", async () => {
    const input = `---
title: Test Card
created: 2026-03-18
source: retro
---

Body here.`;

    const result = await writeCommand(store, "test-card", input);
    expect(result.success).toBe(true);

    const written = await readFile(join(tmpDir, "cards", "test-card.md"), "utf-8");
    expect(written).toContain("title: Test Card");
    expect(written).toContain("modified:");
  });

  it("rejects card missing required frontmatter", async () => {
    const input = `---
title: Missing Source
---

Body.`;

    const result = await writeCommand(store, "bad-card", input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("created");
  });

  it("auto-sets modified date", async () => {
    const input = `---
title: Test
created: 2026-03-18
source: manual
---

Body.`;

    await writeCommand(store, "test", input);
    const written = await readFile(join(tmpDir, "cards", "test.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    const today = new Date().toISOString().split("T")[0];
    // gray-matter may parse date strings as Date objects; normalize before comparing
    const modified = data.modified instanceof Date
      ? data.modified.toISOString().split("T")[0]
      : String(data.modified);
    expect(modified.startsWith(today)).toBe(true);
  });

  it("normalizes created date to YYYY-MM-DD string", async () => {
    const input = `---
title: Date Test
created: 2026-03-18
source: retro
---

Body.`;

    await writeCommand(store, "date-test", input);
    const written = await readFile(join(tmpDir, "cards", "date-test.md"), "utf-8");
    // Should NOT contain ISO datetime format
    expect(written).not.toContain("2026-03-18T00:00:00.000Z");
    // Should contain clean YYYY-MM-DD (unquoted, since no special chars)
    expect(written).toContain("created: 2026-03-18");
  });

  it("rejects card content containing actual token values", async () => {
    const input = `---
title: Secret
created: 2026-03-18
source: retro
---

OPENAI_API_KEY=sk-proj-abc123DEF456ghi789JKL012mno345PQR`;

    const result = await writeCommand(store, "secret", input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
    expect(result.error).not.toContain("sk-proj");
  });

  it("masks tokenized URLs before writing", async () => {
    const input = `---
title: Remote
created: 2026-03-18
source: retro
---

Remote: https://user:secret1234567890@github.com/org/repo.git`;

    const result = await writeCommand(store, "remote", input);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);

    const written = await readFile(join(tmpDir, "cards", "remote.md"), "utf-8");
    expect(written).toContain("https://user:<redacted>@github.com/org/repo.git");
    expect(written).not.toContain("secret1234567890");
  });

  it("does not call autoSync", async () => {
    const syncMod = await import("../../src/lib/sync.js");
    const spy = vi.spyOn(syncMod, "autoSync");

    const input = `---
title: No Sync
created: 2026-03-18
source: retro
---

Body.`;

    await writeCommand(store, "no-sync", input);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
