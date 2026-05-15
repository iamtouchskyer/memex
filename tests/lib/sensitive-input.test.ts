import { describe, it, expect } from "vitest";
import {
  maskFlomoWebhookUrl,
  prepareMemexInput,
  redactSensitiveText,
} from "../../src/lib/sensitive-input.js";

describe("sensitive input guard", () => {
  it("rejects actual OpenAI-style tokens", () => {
    const result = prepareMemexInput("debug sk-proj-abc123DEF456ghi789JKL012mno345PQR", "query");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
    expect(result.error).not.toContain("sk-proj");
  });

  it("allows security architecture language without raw secrets", () => {
    const result = prepareMemexInput(
      "JWT token rotation with httpOnly cookie and Bearer token headers",
      "content",
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Bearer token");
  });

  it("allows discussing token prefixes as knowledge", () => {
    const result = prepareMemexInput("use sk- prefix for API keys and ghp_ for GitHub PATs", "query");
    expect(result.ok).toBe(true);
  });

  it("rejects complete private key blocks", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----";
    const result = prepareMemexInput(key, "content");
    expect(result.ok).toBe(false);
  });

  it("does not reject private-key block names in prose", () => {
    const result = prepareMemexInput("check if BEGIN PRIVATE KEY exists before parsing", "content");
    expect(result.ok).toBe(true);
  });

  it("rejects tokenized URLs in queries", () => {
    const result = prepareMemexInput("https://user:secret1234567890@github.com/org/repo", "query");
    expect(result.ok).toBe(false);
  });

  it("masks tokenized URLs in content", () => {
    const result = prepareMemexInput("remote https://user:secret1234567890@github.com/org/repo", "content");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("https://user:<redacted>@github.com/org/repo");
    expect(result.text).not.toContain("secret1234567890");
    expect(result.warnings).toHaveLength(1);
  });

  it("warns but allows secret locator paths in queries", () => {
    const result = prepareMemexInput("gitee auth workflow ~/.claude/.env", "query");
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("local credential path");
  });

  it("rejects .env secret assignment blocks", () => {
    const result = prepareMemexInput(
      "OPENAI_API_KEY=sk-proj-abc123DEF456ghi789JKL012mno345PQR",
      "content",
    );
    expect(result.ok).toBe(false);
  });

  it("redacts display strings without blocking callers", () => {
    const text = redactSensitiveText(
      "remote https://user:secret123@github.com/org/repo and token ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    );
    expect(text).toContain("https://user:<redacted>@github.com/org/repo");
    expect(text).toContain("<redacted>");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });

  it("rejects AWS access keys", () => {
    const result = prepareMemexInput("key is AKIAIOSFODNN7EXAMPLE", "content");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
  });

  it("rejects Google Cloud API keys", () => {
    const result = prepareMemexInput("key AIzaSyA1234567890abcdefghijklmnopqrstuv", "content");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
  });

  it("rejects Stripe live/test keys", () => {
    // Build dynamically to avoid GitHub push protection false positive
    const fakeKey = "sk" + "_live_" + "a".repeat(30);
    const result = prepareMemexInput(fakeKey, "query");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
  });

  it("rejects npm tokens", () => {
    const result = prepareMemexInput("npm_abcdefghijklmnopqrstuvwxyz1234567890", "content");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sensitive input rejected");
  });

  it("warns on expanded credential paths in queries", () => {
    for (const path of ["~/.netrc", "~/.npmrc", "~/.docker/config.json", "~/.kube/config"]) {
      const result = prepareMemexInput(`check ${path} for creds`, "query");
      expect(result.ok).toBe(true);
      expect(result.warnings[0]).toContain("local credential path");
    }
  });

  it("redacts new secret patterns in display text", () => {
    const text = redactSensitiveText("aws AKIAIOSFODNN7EXAMPLE and npm_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).not.toContain("npm_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(text).toContain("<redacted>");
  });

  it("masks flomo webhook URLs", () => {
    expect(maskFlomoWebhookUrl("https://flomoapp.com/iwh/abc/123/")).toBe(
      "https://flomoapp.com/iwh/<redacted>/",
    );
  });
});
