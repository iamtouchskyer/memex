// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createShareCard } from "../../src/share-card/share-card.js";

describe("createShareCard", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // Clean up injected styles between tests
    document.getElementById("memex-sc-styles")?.remove();
  });

  const sampleData = {
    slug: "test-card",
    title: "Test Card Title",
    body: "Some **bold** content",
    created: "2026-03-20",
    source: "retro",
    links: ["card-a", "card-b"],
    stats: { totalCards: 42, totalDays: 7 },
  };

  it("renders card with title", () => {
    createShareCard(container, { data: sampleData });
    const title = container.querySelector(".memex-sc-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Test Card Title");
  });

  it("renders source badge", () => {
    createShareCard(container, { data: sampleData });
    const source = container.querySelector(".memex-sc-source");
    expect(source!.textContent).toBe("RETRO");
  });

  it("renders date", () => {
    createShareCard(container, { data: sampleData });
    const date = container.querySelector(".memex-sc-date");
    expect(date!.textContent).toBe("2026/03/20");
  });

  it("renders link chips", () => {
    createShareCard(container, { data: sampleData });
    const chips = container.querySelectorAll(".memex-sc-chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe("[[card-a]]");
    expect(chips[1].textContent).toBe("[[card-b]]");
  });

  it("renders footer with stats and brand", () => {
    createShareCard(container, { data: sampleData });
    const stats = container.querySelector(".memex-sc-stats");
    const brand = container.querySelector(".memex-sc-brand");
    expect(stats!.textContent).toBe("42 CARDS · 7 DAYS");
    expect(brand!.textContent).toBe("memex");
  });

  it("renders 6 theme thumbnails", () => {
    createShareCard(container, { data: sampleData });
    const thumbs = container.querySelectorAll(".memex-sc-thumb");
    expect(thumbs.length).toBe(6);
  });

  it("marks initial theme as active", () => {
    createShareCard(container, { data: sampleData, theme: "ocean" });
    const active = container.querySelector(".memex-sc-thumb.active");
    expect(active).not.toBeNull();
    expect(active!.getAttribute("data-theme")).toBe("ocean");
  });

  it("defaults to aurora theme", () => {
    createShareCard(container, { data: sampleData });
    const active = container.querySelector(".memex-sc-thumb.active");
    expect(active!.getAttribute("data-theme")).toBe("aurora");
  });

  it("renders body using markdownRenderer", () => {
    const renderer = (text: string) => `<p>RENDERED:${text}</p>`;
    createShareCard(container, {
      data: sampleData,
      markdownRenderer: renderer,
    });
    const body = container.querySelector(".memex-sc-body");
    expect(body!.innerHTML).toContain("RENDERED:Some **bold** content");
  });

  it("uses identity function when no markdownRenderer provided", () => {
    createShareCard(container, { data: sampleData });
    const body = container.querySelector(".memex-sc-body");
    expect(body!.textContent).toContain("Some **bold** content");
  });

  it("renders download button", () => {
    createShareCard(container, { data: sampleData });
    const btn = container.querySelector('[data-action="export"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("Download");
  });

  it("renders cancel button when onCancel provided", () => {
    createShareCard(container, {
      data: sampleData,
      onCancel: () => {},
    });
    const btn = container.querySelector('[data-action="cancel"]');
    expect(btn).not.toBeNull();
  });

  it("does not render cancel button when onCancel not provided", () => {
    createShareCard(container, { data: sampleData });
    const btn = container.querySelector('[data-action="cancel"]');
    expect(btn).toBeNull();
  });

  it("injects styles into document head", () => {
    createShareCard(container, { data: sampleData });
    const style = document.getElementById("memex-sc-styles");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain(".memex-sc-card");
  });

  it("does not duplicate styles on multiple instances", () => {
    createShareCard(container, { data: sampleData });
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    createShareCard(container2, { data: sampleData });
    const styles = document.querySelectorAll("#memex-sc-styles");
    expect(styles.length).toBe(1);
  });

  // Controller API
  it("setTheme changes card background", () => {
    const card = createShareCard(container, { data: sampleData, theme: "clean" });
    const before = container.querySelector(".memex-sc-card")!.getAttribute("style");
    card.setTheme("ocean");
    const after = container.querySelector(".memex-sc-card")!.getAttribute("style");
    expect(before).not.toBe(after);
    expect(after).toContain("#235ff5");
  });

  it("setTheme ignores unknown theme", () => {
    const card = createShareCard(container, { data: sampleData, theme: "clean" });
    const before = container.querySelector(".memex-sc-card")!.getAttribute("style");
    card.setTheme("nonexistent" as any);
    const after = container.querySelector(".memex-sc-card")!.getAttribute("style");
    expect(before).toBe(after);
  });

  it("setData updates title", () => {
    const card = createShareCard(container, { data: sampleData });
    card.setData({ ...sampleData, title: "New Title" });
    const title = container.querySelector(".memex-sc-title");
    expect(title!.textContent).toBe("New Title");
  });

  it("destroy clears container", () => {
    const card = createShareCard(container, { data: sampleData });
    expect(container.innerHTML).not.toBe("");
    card.destroy();
    expect(container.innerHTML).toBe("");
  });

  // Theme switching via picker click
  it("clicking theme thumbnail switches active state", () => {
    createShareCard(container, { data: sampleData, theme: "clean" });
    const oceanThumb = container.querySelector('[data-theme="ocean"]') as HTMLElement;
    oceanThumb.click();
    expect(oceanThumb.classList.contains("active")).toBe(true);
    const cleanThumb = container.querySelector('[data-theme="clean"]');
    expect(cleanThumb!.classList.contains("active")).toBe(false);
  });

  it("clicking theme thumbnail updates card background", () => {
    createShareCard(container, { data: sampleData, theme: "clean" });
    const spectrumThumb = container.querySelector('[data-theme="spectrum"]') as HTMLElement;
    spectrumThumb.click();
    const card = container.querySelector(".memex-sc-card");
    expect(card!.getAttribute("style")).toContain("linear-gradient");
  });

  // Edge cases
  it("renders with empty data", () => {
    createShareCard(container, { data: {} });
    const title = container.querySelector(".memex-sc-title");
    expect(title!.textContent).toBe("");
  });

  it("renders with no links", () => {
    createShareCard(container, { data: { ...sampleData, links: [] } });
    const links = container.querySelector(".memex-sc-links");
    expect(links).toBeNull();
  });

  it("sets CSS custom properties on body element", () => {
    createShareCard(container, { data: sampleData, theme: "clean" });
    const body = container.querySelector(".memex-sc-body") as HTMLElement;
    const style = body.getAttribute("style")!;
    expect(style).toContain("--sc-code-bg:");
    expect(style).toContain("--sc-table-border:");
    expect(style).toContain("--sc-th-bg:");
    expect(style).toContain("--sc-accent:");
  });

  it("does not contain inline <style> tags inside card", () => {
    createShareCard(container, { data: sampleData });
    const cardEl = container.querySelector(".memex-sc-card");
    const inlineStyles = cardEl!.querySelectorAll("style");
    expect(inlineStyles.length).toBe(0);
  });

  // Word-wrap / overflow tests
  it("body has overflow-wrap for CJK text wrapping", () => {
    createShareCard(container, { data: sampleData });
    const styleEl = document.getElementById("memex-sc-styles");
    const css = styleEl!.textContent!;
    expect(css).toContain(".memex-sc-body");
    expect(css).toContain("overflow-wrap: break-word");
  });

  it("inline code has overflow-wrap for mixed CJK + code content", () => {
    createShareCard(container, { data: sampleData });
    const styleEl = document.getElementById("memex-sc-styles");
    const css = styleEl!.textContent!;
    // The .memex-sc-body code rule should include overflow-wrap
    expect(css).toMatch(/\.memex-sc-body code\s*\{[^}]*overflow-wrap:\s*break-word/);
  });
});
