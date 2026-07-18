import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";
import { suggestLinks } from "../../src/lib/suggest-links.js";

describe("suggestLinks", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-suggest-test-"));
    const cardsDir = join(tmpDir, "cards");
    const archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns lexically relevant existing cards", async () => {
    await writeFile(
      join(tmpDir, "cards", "jwt-migration.md"),
      "---\ntitle: JWT Migration\ncreated: 2026-01-01\nsource: test\ntags: jwt, auth\n---\nMoving to stateless JWT tokens.",
    );
    await writeFile(
      join(tmpDir, "cards", "css-grid.md"),
      "---\ntitle: CSS Grid\ncreated: 2026-01-01\nsource: test\ntags: css\n---\nLayout with grid.",
    );
    const result = await suggestLinks(
      store,
      "jwt-revocation",
      { title: "JWT Revocation", tags: ["jwt", "auth"] },
      "How to revoke a JWT token when using stateless auth.",
    );
    expect(result).toContain("jwt-migration");
    expect(result).not.toContain("css-grid");
  });

  it("excludes the card itself", async () => {
    await writeFile(
      join(tmpDir, "cards", "jwt-notes.md"),
      "---\ntitle: JWT Notes\ncreated: 2026-01-01\nsource: test\ntags: jwt\n---\nJWT token stuff.",
    );
    const result = await suggestLinks(
      store,
      "jwt-notes",
      { title: "JWT Notes", tags: ["jwt"] },
      "JWT token stuff.",
    );
    expect(result).not.toContain("jwt-notes");
  });

  it("excludes cards already linked in the body", async () => {
    await writeFile(
      join(tmpDir, "cards", "jwt-migration.md"),
      "---\ntitle: JWT Migration\ncreated: 2026-01-01\nsource: test\ntags: jwt\n---\nStateless JWT tokens.",
    );
    const result = await suggestLinks(
      store,
      "jwt-revocation",
      { title: "JWT Revocation", tags: ["jwt"] },
      "Revoke a JWT. See [[jwt-migration]] for context.",
    );
    expect(result).not.toContain("jwt-migration");
  });

  it("caps suggestions at 3", async () => {
    for (let i = 0; i < 6; i++) {
      await writeFile(
        join(tmpDir, "cards", `auth-note-${i}.md`),
        `---\ntitle: Auth Note ${i}\ncreated: 2026-01-01\nsource: test\ntags: auth, jwt\n---\nJWT auth token handling ${i}.`,
      );
    }
    const result = await suggestLinks(
      store,
      "new-auth-card",
      { title: "New Auth Card", tags: ["auth", "jwt"] },
      "JWT auth token handling notes.",
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns empty when no card is relevant", async () => {
    await writeFile(
      join(tmpDir, "cards", "cooking.md"),
      "---\ntitle: Cooking\ncreated: 2026-01-01\nsource: test\n---\nHow to bake bread.",
    );
    const result = await suggestLinks(
      store,
      "quantum-physics",
      { title: "Quantum Physics", tags: ["physics"] },
      "Entanglement and superposition of qubits.",
    );
    expect(result).toEqual([]);
  });
});
