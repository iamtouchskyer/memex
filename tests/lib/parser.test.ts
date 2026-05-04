import { describe, it, expect } from "vitest";
import { parseFrontmatter, extractLinks, stringifyFrontmatter } from "../../src/lib/parser.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = `---
title: Test Card
created: 2026-03-18
modified: 2026-03-18
source: retro
---

Body content here.`;

    const result = parseFrontmatter(content);
    expect(result.data.title).toBe("Test Card");
    expect(result.data.source).toBe("retro");
    expect(result.content).toContain("Body content here.");
  });

  it("returns empty data for content without frontmatter", () => {
    const result = parseFrontmatter("Just plain text.");
    expect(result.data).toEqual({});
    expect(result.content).toBe("Just plain text.");
  });

  it("gracefully handles unparseable YAML frontmatter (fixes #27)", () => {
    // The `#1)` triggers a YAML parse error: js-yaml treats # as comment start
    const content = `---
title: Agent Memory Taxonomy
source: "Memory in the Age of AI Agents" (arxiv 2512.13564, HF Daily Paper #1)
---

Body content here.`;

    const result = parseFrontmatter(content);
    // Should not throw — returns fallback with empty data
    expect(result.data).toEqual({});
    expect(result.content).toContain("Body content here.");
  });
});

describe("extractLinks", () => {
  it("extracts wikilinks from content", () => {
    const content = "See [[stateless-auth]] and also [[redis-session-store]] for details.";
    const links = extractLinks(content);
    expect(links).toEqual(["stateless-auth", "redis-session-store"]);
  });

  it("returns empty array when no links", () => {
    const links = extractLinks("No links here.");
    expect(links).toEqual([]);
  });

  it("deduplicates links", () => {
    const content = "See [[foo]] and then [[foo]] again.";
    const links = extractLinks(content);
    expect(links).toEqual(["foo"]);
  });

  it("strips pipe aliases from wikilinks", () => {
    const content = "See [[dreaming|OpenClaw dreaming metaphor]] and [[target|display text]].";
    const links = extractLinks(content);
    expect(links).toEqual(["dreaming", "target"]);
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const content = "Real [[link-a]].\n```\n[[not-a-link]]\n```\nAlso [[link-b]].";
    const links = extractLinks(content);
    expect(links).toEqual(["link-a", "link-b"]);
  });

  it("ignores wikilinks inside inline code", () => {
    const content = "Use `[[not-a-link]]` to reference, but [[real-link]] works.";
    const links = extractLinks(content);
    expect(links).toEqual(["real-link"]);
  });

  it("handles pipe alias with no display text gracefully", () => {
    const content = "See [[target|]].";
    const links = extractLinks(content);
    expect(links).toEqual(["target"]);
  });

  it("extracts links only from body, not frontmatter", () => {
    const content = `---
title: "About [[not-a-link]]"
---

Real link to [[actual-link]].`;

    const { content: body } = parseFrontmatter(content);
    const links = extractLinks(body);
    expect(links).toEqual(["actual-link"]);
  });
});

describe("stringifyFrontmatter", () => {
  it("produces valid frontmatter for simple values", () => {
    const result = stringifyFrontmatter("Body text", {
      title: "My Card",
      created: "2026-03-24",
      source: "retro",
    });
    expect(result).toBe(
      "---\ntitle: My Card\ncreated: 2026-03-24\nsource: retro\n---\nBody text"
    );
  });

  it("quotes values containing colons", () => {
    const result = stringifyFrontmatter("Content", {
      title: "Note: important",
    });
    expect(result).toContain("title: 'Note: important'");
  });

  it("quotes values containing hash signs", () => {
    const result = stringifyFrontmatter("Content", {
      title: "Issue #42",
    });
    expect(result).toContain("title: 'Issue #42'");
  });

  it("quotes values containing square brackets", () => {
    const result = stringifyFrontmatter("Content", {
      title: "[WIP] Draft",
    });
    expect(result).toContain("title: '[WIP] Draft'");
  });

  it("quotes values containing curly braces", () => {
    const result = stringifyFrontmatter("Content", {
      title: "{config} object",
    });
    expect(result).toContain("title: '{config} object'");
  });

  it("escapes single quotes by doubling them", () => {
    const result = stringifyFrontmatter("Content", {
      title: "it's a test",
    });
    expect(result).toContain("title: 'it''s a test'");
  });

  it("quotes empty string values", () => {
    const result = stringifyFrontmatter("Content", {
      title: "",
    });
    expect(result).toContain("title: ''");
  });

  it("skips null and undefined values", () => {
    const result = stringifyFrontmatter("Content", {
      title: "Hello",
      removed: null,
      missing: undefined,
    });
    expect(result).not.toContain("removed");
    expect(result).not.toContain("missing");
  });

  it("collapses multiline values into single line", () => {
    const result = stringifyFrontmatter("Content", {
      description: "line one\nline two\nline three",
    });
    expect(result).toContain("description: line one line two line three");
    // Should not contain literal newlines in the YAML value
    const yamlSection = result.split("---")[1];
    expect(yamlSection.split("\n").length).toBe(3); // empty + description + empty
  });

  it("quotes values with ampersand", () => {
    const result = stringifyFrontmatter("Content", {
      title: "A & B",
    });
    expect(result).toContain("title: 'A & B'");
  });

  it("quotes values with asterisk", () => {
    const result = stringifyFrontmatter("Content", {
      title: "*bold*",
    });
    expect(result).toContain("title: '*bold*'");
  });

  it("quotes values with exclamation mark", () => {
    const result = stringifyFrontmatter("Content", {
      title: "Alert!",
    });
    expect(result).toContain("title: 'Alert!'");
  });

  it("quotes values with percent sign", () => {
    const result = stringifyFrontmatter("Content", {
      title: "100% done",
    });
    expect(result).toContain("title: '100% done'");
  });

  it("quotes values with at sign", () => {
    const result = stringifyFrontmatter("Content", {
      title: "user@host",
    });
    expect(result).toContain("title: 'user@host'");
  });

  it("quotes values with backtick", () => {
    const result = stringifyFrontmatter("Content", {
      title: "use `code`",
    });
    expect(result).toContain("title: 'use `code`'");
  });

  it("roundtrips through parse and stringify", () => {
    const original = {
      title: "Test: roundtrip",
      created: "2026-03-24",
      source: "retro",
    };
    const body = "Some body with [[links]]";
    const serialized = stringifyFrontmatter(body, original);
    const parsed = parseFrontmatter(serialized);
    expect(parsed.data.title).toBe("Test: roundtrip");
    // gray-matter parses bare dates as Date objects
    expect(parsed.data.created).toBeInstanceOf(Date);
    expect(parsed.data.source).toBe("retro");
    expect(parsed.content.trim()).toBe(body);
  });

  it("handles combined special characters", () => {
    const result = stringifyFrontmatter("Content", {
      title: "it's a [test]: #1 & *important*",
    });
    // Should be quoted and single quotes escaped
    expect(result).toContain("'it''s a [test]: #1 & *important*'");
  });
});
