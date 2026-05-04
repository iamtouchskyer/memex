import { describe, it, expect } from "vitest";
import { formatSearchResult, formatCardList, formatLinkStats, formatCardLinks, formatCompactSearchResult } from "../../src/lib/formatter.js";

describe("formatCardList", () => {
  it("formats slug + title pairs", () => {
    const cards = [
      { slug: "foo", title: "Foo Card" },
      { slug: "bar-baz", title: "Bar Baz" },
    ];
    const output = formatCardList(cards);
    expect(output).toContain("foo");
    expect(output).toContain("Foo Card");
    expect(output).toContain("bar-baz");
    expect(output).toContain("Bar Baz");
  });
});

describe("formatSearchResult", () => {
  it("formats card with title, first paragraph, and links", () => {
    const result = {
      slug: "jwt-migration",
      title: "JWT Migration",
      firstParagraph: "JWT is tricky.",
      matchLine: null,
      links: ["auth", "redis"],
    };
    const output = formatSearchResult(result);
    expect(output).toContain("## jwt-migration");
    expect(output).toContain("JWT Migration");
    expect(output).toContain("JWT is tricky.");
    expect(output).toContain("Links: [[auth]], [[redis]]");
    expect(output).not.toContain("匹配行");
  });

  it("includes match line when different from first paragraph", () => {
    const result = {
      slug: "caching",
      title: "Caching",
      firstParagraph: "Caching overview.",
      matchLine: "...revoke can use cache fallback...",
      links: [],
    };
    const output = formatSearchResult(result);
    expect(output).toContain("> 匹配行: ...revoke can use cache fallback...");
  });
});

describe("formatLinkStats", () => {
  it("formats global link stats with orphan/hub labels", () => {
    const stats = [
      { slug: "a", outbound: 3, inbound: 12 },
      { slug: "b", outbound: 1, inbound: 0 },
      { slug: "c", outbound: 2, inbound: 3 },
    ];
    const output = formatLinkStats(stats);
    expect(output).toContain("hub");
    expect(output).toContain("orphan");
  });
});

describe("formatCardLinks", () => {
  it("formats outbound and inbound links for a card", () => {
    const output = formatCardLinks("my-card", ["out1", "out2"], ["in1"]);
    expect(output).toContain("## my-card");
    expect(output).toContain("Outbound: [[out1]], [[out2]]");
    expect(output).toContain("Inbound:  [[in1]]");
  });
});

describe("formatCompactSearchResult", () => {
  const baseResult = {
    slug: "jwt-migration",
    title: "JWT Migration",
    firstParagraph: "JWT is tricky.",
    matchLine: null,
    links: ["auth", "redis"],
  };

  it("returns slug and title on one line", () => {
    const output = formatCompactSearchResult(baseResult);
    expect(output).toContain("jwt-migration");
    expect(output).toContain("JWT Migration");
    expect(output.split("\n")).toHaveLength(1);
  });

  it("includes score formatted to 2 decimal places when provided", () => {
    const output = formatCompactSearchResult(baseResult, 0.8567);
    expect(output).toContain("[0.86]");
  });

  it("omits score bracket when no score given", () => {
    const output = formatCompactSearchResult(baseResult);
    expect(output).not.toContain("[");
    expect(output).not.toContain("]");
  });

  it("is significantly shorter than formatSearchResult for the same input", () => {
    const compact = formatCompactSearchResult(baseResult, 0.85);
    const full = formatSearchResult(baseResult);
    expect(compact.length).toBeLessThan(full.length);
  });
});
