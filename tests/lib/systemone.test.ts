import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";
import { readConfig } from "../../src/lib/config.js";
import {
  normalizeSystemOnePath,
  parseKeyFromEnvFile,
  evaluateWriteWithSystemOne,
  rerankWithSystemOne,
  inspectPairsWithSystemOne,
  SystemOneDecisionProvider,
  type DecisionProvider,
  type SystemOneQuestion,
  type SystemOneResponse,
} from "../../src/lib/systemone.js";
import { writeCommand } from "../../src/commands/write.js";
import { searchCommand } from "../../src/commands/search.js";
import { organizeCommand } from "../../src/commands/organize.js";

class MockDecisionProvider implements DecisionProvider {
  readonly model = "mock-decision-1";
  public lastState: unknown;
  public lastQuestions: Record<string, SystemOneQuestion> = {};

  constructor(private handler: (state: any, questions: Record<string, SystemOneQuestion>) => SystemOneResponse["answers"]) {}

  async decide(
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
  ): Promise<SystemOneResponse> {
    this.lastState = state;
    this.lastQuestions = questions;
    return {
      model: this.model,
      answers: this.handler(state, questions),
    };
  }
}

describe("SystemOne config & helpers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-sysone-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("normalizes SystemOne endpoint paths", () => {
    expect(normalizeSystemOnePath("")).toBe("/v1/systemone");
    expect(normalizeSystemOnePath("/")).toBe("/v1/systemone");
    expect(normalizeSystemOnePath("/v1")).toBe("/v1/systemone");
    expect(normalizeSystemOnePath("/alt/v1/")).toBe("/alt/v1/systemone");
    expect(normalizeSystemOnePath("/providers/microsoft/v1/systemone")).toBe(
      "/providers/microsoft/v1/systemone",
    );
  });

  it("parses env/key files cleanly", () => {
    const parsed = parseKeyFromEnvFile(
      "# comment\nOPENAI_BASE_URL=https://example.com/v1\nOPENAI_API_KEY=\"secret-token\"\n",
    );
    expect(parsed.baseUrl).toBe("https://example.com/v1");
    expect(parsed.apiKey).toBe("secret-token");

    const rawOnly = parseKeyFromEnvFile("bare-key-123\n");
    expect(rawOnly.apiKey).toBe("bare-key-123");
  });

  it("reads decision config and experimental.systemOneMemory from .memexrc", async () => {
    await writeFile(
      join(tmpDir, ".memexrc"),
      JSON.stringify({
        decisionProvider: "systemone",
        decisionBaseUrl: "https://example.com/v1",
        decisionApiKey: "test-key",
        decisionApiKeyPath: "~/.config/decision.env",
        decisionModel: "microsoft-decision-1",
        experimental: {
          systemOneMemory: true,
        },
      }),
    );
    const cfg = await readConfig(tmpDir);
    expect(cfg.decisionProvider).toBe("systemone");
    expect(cfg.decisionBaseUrl).toBe("https://example.com/v1");
    expect(cfg.decisionApiKey).toBe("test-key");
    expect(cfg.decisionApiKeyPath).toBe("~/.config/decision.env");
    expect(cfg.decisionModel).toBe("microsoft-decision-1");
    expect(cfg.experimental?.systemOneMemory).toBe(true);
  });

  it("throws clear error when API key or baseUrl is missing", () => {
    const prevKey = process.env.MEMEX_DECISION_API_KEY;
    const prevOpenaiKey = process.env.OPENAI_API_KEY;
    delete process.env.MEMEX_DECISION_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new SystemOneDecisionProvider({})).toThrow(/API key required/);
      expect(() => new SystemOneDecisionProvider({ apiKey: "k" })).toThrow(/base URL required/);
    } finally {
      if (prevKey) process.env.MEMEX_DECISION_API_KEY = prevKey;
      if (prevOpenaiKey) process.env.OPENAI_API_KEY = prevOpenaiKey;
    }
  });
});

describe("SystemOne controllers & command integration", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-sysone-cmd-"));
    const cardsDir = join(tmpDir, "cards");
    const archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("evaluates write action and filters noisy lexical candidates via SystemOne", async () => {
    await writeFile(
      join(tmpDir, "cards", "5k-old.md"),
      "---\ntitle: Charity 5K Run Record\ncreated: 2026-05-23\nsource: user\n---\nPersonal best for the charity 5K run is 27:12.",
    );
    await writeFile(
      join(tmpDir, "cards", "5k-distractor.md"),
      "---\ntitle: 5K Monitor Resolution\ncreated: 2026-05-24\nsource: user\n---\nBought a new 5K display for the home office.",
    );

    const mockProvider = new MockDecisionProvider((state) => {
      const cands = state.existing_candidates as Array<{ id: string; slug: string }>;
      const answers: SystemOneResponse["answers"] = {
        write_action: {
          type: "choice",
          choice: "update",
          confidence: 0.94,
          probabilities: { create: 0.05, update: 0.94, skip_duplicate: 0.01 },
        },
      };
      for (const c of cands) {
        if (c.slug === "5k-old") {
          answers[`${c.id}_link`] = { type: "noul", noul: 0.98 };
          answers[`${c.id}_rel`] = {
            type: "choice",
            choice: "state_update",
            confidence: 0.95,
            probabilities: { state_update: 0.95, complementary: 0.05, contradicts: 0, duplicate: 0, unrelated: 0 },
          };
        } else {
          answers[`${c.id}_link`] = { type: "noul", noul: 0.03 };
          answers[`${c.id}_rel`] = {
            type: "choice",
            choice: "unrelated",
            confidence: 0.99,
            probabilities: { state_update: 0, complementary: 0, contradicts: 0, duplicate: 0, unrelated: 0.99 },
          };
        }
      }
      return answers;
    });

    const res = await writeCommand(
      store,
      "5k-new",
      "---\ntitle: New 5K Personal Best\ncreated: 2026-05-30\nsource: user\n---\nRan a 5K in 25:50, beating the old personal best.",
      { _decisionProvider: mockProvider },
    );

    expect(res.success).toBe(true);
    expect(res.decision?.action).toBe("update");
    expect(res.decision?.updateTargetSlug).toBe("5k-old");
    expect(res.decision?.recommendedLinks.map((l) => l.slug)).toEqual(["5k-old"]);
    expect(res.warnings?.some((w) => w.includes("updates existing card [[5k-old]]"))).toBe(true);
  });

  it("reranks and filters search results via SystemOne", async () => {
    await writeFile(
      join(tmpDir, "cards", "distractor.md"),
      "---\ntitle: Marathon Movie Night\ncreated: 2026-05-01\nsource: user\n---\nWatched a marathon of Lord of the Rings movies.",
    );
    await writeFile(
      join(tmpDir, "cards", "gold-card.md"),
      "---\ntitle: Running Training Log\ncreated: 2026-05-10\nsource: user\n---\nFinished the city marathon in 3 hours 45 minutes, 15 minutes slower than my goal.",
    );

    const mockProvider = new MockDecisionProvider((state) => {
      const cands = state.candidates as Array<{ id: string; slug: string }>;
      const answers: SystemOneResponse["answers"] = {
        sufficient: { type: "noul", noul: 0.96 },
      };
      for (const c of cands) {
        if (c.slug === "gold-card") {
          answers[`${c.id}_rel`] = { type: "noul", noul: 0.99 };
          answers[`${c.id}_util`] = {
            type: "score",
            score: 2.95,
            legend: { "0": "Irrelevant", "1": "Bg", "2": "Partial", "3": "Direct" },
            probabilities: { "0": 0, "1": 0, "2": 0.05, "3": 0.95 },
          };
        } else {
          answers[`${c.id}_rel`] = { type: "noul", noul: 0.02 };
          answers[`${c.id}_util`] = {
            type: "score",
            score: 0.05,
            legend: { "0": "Irrelevant", "1": "Bg", "2": "Partial", "3": "Direct" },
            probabilities: { "0": 0.95, "1": 0.05, "2": 0, "3": 0 },
          };
        }
      }
      return answers;
    });

    const res = await searchCommand(store, "marathon time goal", {
      limit: 5,
      compact: true,
      _decisionProvider: mockProvider,
    });

    expect(res.exitCode).toBe(0);
    expect(res.output).toContain("gold-card");
    expect(res.output).not.toContain("distractor");
    expect(res.rerank?.sufficientEvidence).toBe(true);
  });

  it("inspects organize pairs via SystemOne", async () => {
    await writeFile(
      join(tmpDir, "cards", "card-1.md"),
      "---\ntitle: Server Config v1\ncreated: 2026-03-01\nmodified: 2026-03-25\nsource: user\n---\nMax body size is 1MB. See [[card-2]].",
    );
    await writeFile(
      join(tmpDir, "cards", "card-2.md"),
      "---\ntitle: Server Config v2\ncreated: 2026-03-20\nmodified: 2026-03-25\nsource: user\n---\nIncreased nginx client_max_body_size to 100MB.",
    );

    const mockProvider = new MockDecisionProvider(() => ({
      p0_verdict: {
        type: "choice",
        choice: "state_update",
        confidence: 0.92,
        probabilities: { consistent: 0.05, state_update: 0.92, contradictory: 0.02, redundant_merge: 0.01 },
      },
      p0_attn: { type: "noul", noul: 0.95 },
    }));

    const res = await organizeCommand(store, null, false, {
      _decisionProvider: mockProvider,
    });

    expect(res.exitCode).toBe(0);
    expect(res.output).toContain("[state_update, attn=0.95]");
    expect(res.pairDecisions?.[0]?.verdict).toBe("state_update");
  });
});
