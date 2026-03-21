import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommand, validateSlug } from "../../src/commands/write.js";
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
    expect(String(data.modified).startsWith(today)).toBe(true);
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
    // Should contain clean YYYY-MM-DD
    expect(written).toContain("created: '2026-03-18'");
  });

  it("rejects empty slug", async () => {
    const input = `---
title: Empty Slug Test
created: 2026-03-21
source: test
---
body`;
    const result = await writeCommand(store, "", input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("rejects whitespace-only slug", async () => {
    const input = `---
title: Whitespace Slug
created: 2026-03-21
source: test
---
body`;
    const result = await writeCommand(store, "   ", input);
    expect(result.success).toBe(false);
  });

  it("rejects slug with reserved characters", async () => {
    const input = `---
title: Reserved Chars
created: 2026-03-21
source: test
---
body`;
    const result = await writeCommand(store, "my:card", input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("reserved");
  });
});

describe("validateSlug", () => {
  it("accepts valid kebab-case slugs", () => {
    expect(validateSlug("my-card")).toBeNull();
    expect(validateSlug("my-card-123")).toBeNull();
  });

  it("accepts valid subdirectory slugs", () => {
    expect(validateSlug("sub/my-card")).toBeNull();
    expect(validateSlug("a/b/c")).toBeNull();
  });

  it("accepts slugs with unicode (e.g. CJK)", () => {
    // Unicode slugs are allowed but not recommended
    expect(validateSlug("我的卡片")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateSlug("")).not.toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(validateSlug("   ")).not.toBeNull();
  });

  it("rejects slug of only dots/slashes", () => {
    expect(validateSlug(".")).not.toBeNull();
    expect(validateSlug("..")).not.toBeNull();
    expect(validateSlug("/")).not.toBeNull();
    expect(validateSlug("./")).not.toBeNull();
  });

  it("rejects slug with empty path segment", () => {
    expect(validateSlug("a//b")).not.toBeNull();
    expect(validateSlug("/foo")).not.toBeNull();
  });

  it("rejects slug with reserved OS characters", () => {
    expect(validateSlug("my:card")).not.toBeNull();
    expect(validateSlug('my"card')).not.toBeNull();
    expect(validateSlug("my*card")).not.toBeNull();
    expect(validateSlug("my?card")).not.toBeNull();
  });
});
