import { describe, it, expect } from "vitest";
import { diagnoseGitError } from "../../src/lib/sync.js";

describe("diagnoseGitError", () => {
  describe("SSH authentication errors", () => {
    it("detects SSH publickey failure with SSH remote", () => {
      const hint = diagnoseGitError(
        "Permission denied (publickey)",
        "git@github.com:user/repo.git"
      );
      expect(hint).toContain("SSH authentication failed");
      expect(hint).toContain("ssh -T git@github.com");
      expect(hint).toContain("ssh-keygen");
      expect(hint).toContain("switch to HTTPS");
    });

    it("detects SSH auth failure with ssh:// remote", () => {
      const hint = diagnoseGitError(
        "authentication failed for ssh://git@github.com/user/repo",
        "ssh://git@github.com/user/repo"
      );
      expect(hint).toContain("SSH authentication failed");
    });

    it("returns generic auth hint for HTTPS remote", () => {
      const hint = diagnoseGitError(
        "Authentication failed",
        "https://github.com/user/repo.git"
      );
      expect(hint).toContain("Authentication failed");
      expect(hint).toContain("gh auth login");
      expect(hint).not.toContain("SSH authentication failed");
    });

    it("returns generic auth hint when no remote provided", () => {
      const hint = diagnoseGitError("Permission denied (publickey)");
      expect(hint).toContain("Authentication failed");
      expect(hint).toContain("gh auth login");
    });
  });

  describe("network errors", () => {
    it("detects DNS resolution failure", () => {
      const hint = diagnoseGitError("fatal: Could not resolve host: github.com");
      expect(hint).toContain("Network error");
      expect(hint).toContain("internet connection");
    });

    it("detects network unreachable", () => {
      const hint = diagnoseGitError("Network is unreachable");
      expect(hint).toContain("Network error");
    });
  });

  describe("repository not found", () => {
    it("detects repo not found", () => {
      const hint = diagnoseGitError(
        "ERROR: Repository not found.",
        "git@github.com:user/nonexistent.git"
      );
      expect(hint).toContain("Remote repository not found");
      expect(hint).toContain("URL exists");
    });

    it("detects does not exist error", () => {
      const hint = diagnoseGitError(
        "fatal: '/path/to/repo' does not exist"
      );
      expect(hint).toContain("Remote repository not found");
    });
  });

  describe("unrecognized errors", () => {
    it("returns empty string for unknown git errors", () => {
      const hint = diagnoseGitError("fatal: some unknown error occurred");
      expect(hint).toBe("");
    });

    it("returns empty string for empty input", () => {
      const hint = diagnoseGitError("");
      expect(hint).toBe("");
    });
  });

  describe("case insensitivity", () => {
    it("matches regardless of case", () => {
      const hint = diagnoseGitError("PERMISSION DENIED (PUBLICKEY)");
      expect(hint).toContain("Authentication failed");
    });
  });
});
