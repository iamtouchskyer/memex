import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CardStore } from "./store.js";
import { parseFrontmatter, extractLinks } from "./parser.js";
import { tokenizeQuery, buildSearchableFields, scoreCard } from "./scoring.js";

export type DecisionProviderType = "systemone";

export interface SystemOneNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export interface SystemOneChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface SystemOneScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type SystemOneQuestion =
  | SystemOneNoulQuestion
  | SystemOneChoiceQuestion
  | SystemOneScoreQuestion;

export interface SystemOneNoulAnswer {
  type: "noul";
  noul: number;
}

export interface SystemOneChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities: Record<string, number>;
}

export interface SystemOneScoreAnswer {
  type: "score";
  score: number;
  confidence?: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type SystemOneAnswer =
  | SystemOneNoulAnswer
  | SystemOneChoiceAnswer
  | SystemOneScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface DecisionProvider {
  readonly model: string;
  decide(
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
  ): Promise<SystemOneResponse>;
}

const DEFAULT_DECISION_MODEL = "microsoft-decision-1";

export interface SystemOneProviderOptions {
  apiKey?: string;
  apiKeyPath?: string;
  baseUrl?: string;
  model?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

function resolveHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function parseKeyFromEnvFile(content: string): { apiKey?: string; baseUrl?: string } {
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!val) continue;
    if (
      key === "MEMEX_DECISION_API_KEY" ||
      key === "OPENAI_API_KEY" ||
      key === "EDGE_PROXY_TOKEN" ||
      key === "API_KEY"
    ) {
      apiKey = apiKey ?? val;
    } else if (
      key === "MEMEX_DECISION_BASE_URL" ||
      key === "OPENAI_BASE_URL" ||
      key === "BASE_URL"
    ) {
      baseUrl = baseUrl ?? val;
    }
  }
  // If file has no key=value lines, treat whole trimmed text as a raw key
  if (!apiKey && !content.includes("=")) {
    const raw = content.trim();
    if (raw) apiKey = raw;
  }
  return { apiKey, baseUrl };
}

function readEnvOrKeyFile(path: string): { apiKey?: string; baseUrl?: string } {
  try {
    const content = readFileSync(resolveHomePath(path), "utf-8");
    return parseKeyFromEnvFile(content);
  } catch {
    return {};
  }
}

export function normalizeSystemOnePath(basePath: string): string {
  const clean = basePath.replace(/\/$/, "");
  if (!clean || clean === "/") return "/v1/systemone";
  if (clean.endsWith("/systemone")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/systemone`;
  return `${clean}/v1/systemone`;
}

export class SystemOneDecisionProvider implements DecisionProvider {
  readonly model: string;
  private apiKey: string;
  private baseHostname: string;
  private requestPath: string;
  private basePort: number | undefined;
  private useHttp: boolean;
  private extraHeaders: Record<string, string>;
  private timeoutMs: number;

  constructor(options: SystemOneProviderOptions = {}) {
    const keyFilePath =
      options.apiKeyPath ??
      process.env.MEMEX_DECISION_API_KEY_FILE;
    const fromFile = keyFilePath ? readEnvOrKeyFile(keyFilePath) : {};

    const apiKey =
      options.apiKey ??
      process.env.MEMEX_DECISION_API_KEY ??
      fromFile.apiKey ??
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Decision API key required: set decisionApiKey in .memexrc, MEMEX_DECISION_API_KEY, or MEMEX_DECISION_API_KEY_FILE",
      );
    }

    const baseUrl =
      options.baseUrl ??
      process.env.MEMEX_DECISION_BASE_URL ??
      fromFile.baseUrl ??
      process.env.OPENAI_BASE_URL;

    if (!baseUrl) {
      throw new Error(
        "Decision base URL required: set decisionBaseUrl in .memexrc or MEMEX_DECISION_BASE_URL",
      );
    }

    this.apiKey = apiKey;
    this.model =
      options.model ??
      process.env.MEMEX_DECISION_MODEL ??
      DEFAULT_DECISION_MODEL;

    const parsed = new URL(baseUrl);
    this.baseHostname = parsed.hostname;
    this.requestPath = normalizeSystemOnePath(parsed.pathname);
    this.basePort = parsed.port ? Number(parsed.port) : undefined;
    this.useHttp = parsed.protocol === "http:";
    this.extraHeaders = options.extraHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  decide(
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
  ): Promise<SystemOneResponse> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        state,
        questions,
      });

      const reqFn = this.useHttp ? httpRequest : httpsRequest;
      const reqOptions: Record<string, unknown> = {
        hostname: this.baseHostname,
        path: this.requestPath,
        method: "POST",
        timeout: this.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
          "Content-Length": Buffer.byteLength(body),
        },
      };
      if (this.basePort) reqOptions.port = this.basePort;

      const req = reqFn(reqOptions as any, (res: any) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `SystemOne API HTTP ${res.statusCode}: ${data.slice(0, 300)}`,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(data) as SystemOneResponse & {
              error?: { message?: string };
            };
            if (parsed.error) {
              reject(
                new Error(
                  `SystemOne API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
                ),
              );
              return;
            }
            if (!parsed.answers || typeof parsed.answers !== "object") {
              reject(
                new Error(
                  "Unexpected SystemOne response: missing answers object",
                ),
              );
              return;
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse SystemOne response: ${e}`));
          }
        });
      });

      req.on("timeout", () => {
        req.destroy(new Error(`SystemOne request timed out after ${this.timeoutMs}ms`));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

export function createDecisionProvider(
  options: SystemOneProviderOptions = {},
): DecisionProvider {
  return new SystemOneDecisionProvider(options);
}

// ============================================================================
// High-level System-One Memory Controllers (Jev-Mem inspired)
// ============================================================================

export type WriteActionType = "create" | "update" | "skip_duplicate";
export type CandidateRelationType =
  | "state_update"
  | "complementary"
  | "contradicts"
  | "duplicate"
  | "unrelated";

export interface CandidateLinkDecision {
  slug: string;
  title: string;
  lexicalScore: number;
  shouldLink: boolean;
  linkProbability: number;
  relation: CandidateRelationType;
  relationConfidence: number;
}

export interface WriteDecisionResult {
  action: WriteActionType;
  actionConfidence: number;
  actionProbabilities: Record<string, number>;
  candidates: CandidateLinkDecision[];
  recommendedLinks: CandidateLinkDecision[];
  updateTargetSlug?: string;
}

/**
 * Evaluate a new card being written against top lexical candidates using a
 * single batched SystemOne request (Jev-Mem write & link controller).
 */
export async function evaluateWriteWithSystemOne(
  store: CardStore,
  provider: DecisionProvider,
  slug: string,
  data: Record<string, unknown>,
  content: string,
  options: { candidateLimit?: number; linkThreshold?: number; excerptChars?: number } = {},
): Promise<WriteDecisionResult> {
  const candidateLimit = options.candidateLimit ?? 6;
  const linkThreshold = options.linkThreshold ?? 0.25;
  const excerptChars = options.excerptChars ?? 2400;

  const query = [
    String(data.title || slug),
    typeof data.category === "string" ? data.category : "",
    content.slice(0, 3000),
  ]
    .filter(Boolean)
    .join(" ");

  const { tokens, originalTokens } = tokenizeQuery(query);
  const alreadyLinked = new Set(extractLinks(content));
  const allCards = await store.scanAll();

  const scored: Array<{
    slug: string;
    title: string;
    created: string;
    excerpt: string;
    score: number;
  }> = [];

  for (const card of allCards) {
    if (card.slug === slug || alreadyLinked.has(card.slug)) continue;
    const raw = await store.readCard(card.slug);
    const parsed = parseFrontmatter(raw);
    const fields = buildSearchableFields(
      card.slug,
      parsed.data,
      parsed.content,
      extractLinks(parsed.content),
    );
    const match = tokens.length > 0 ? scoreCard(tokens, originalTokens, fields) : null;
    const lexicalScore = match ? match.score : 0;
    if (lexicalScore > 0 || allCards.length <= candidateLimit) {
      scored.push({
        slug: card.slug,
        title: String(parsed.data.title || card.slug),
        created: String(parsed.data.created || ""),
        excerpt: parsed.content.trim().slice(0, excerptChars),
        score: lexicalScore,
      });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.slug.localeCompare(b.slug)));
  const topCandidates = scored.slice(0, candidateLimit);

  if (topCandidates.length === 0) {
    return {
      action: "create",
      actionConfidence: 1,
      actionProbabilities: { create: 1, update: 0, skip_duplicate: 0 },
      candidates: [],
      recommendedLinks: [],
    };
  }

  const state = {
    new_card: {
      slug,
      title: String(data.title || slug),
      created: String(data.created || ""),
      content: content.trim().slice(0, excerptChars),
    },
    existing_candidates: topCandidates.map((c, idx) => ({
      id: `c${idx}`,
      slug: c.slug,
      title: c.title,
      created: c.created,
      excerpt: c.excerpt,
    })),
  };

  const questions: Record<string, SystemOneQuestion> = {
    write_action: {
      type: "choice",
      instructions:
        "Given new_card and existing_candidates, what memory action should be taken for new_card?",
      criteria: {
        create:
          "new_card introduces distinct new facts, events, or insights that should be stored as a separate card",
        update:
          "new_card directly updates, revises, or supersedes the state of a specific existing candidate card on the exact same subject",
        skip_duplicate:
          "new_card is redundant and repeats information already fully captured in an existing candidate card",
      },
    },
  };

  for (let i = 0; i < topCandidates.length; i++) {
    const cid = `c${i}`;
    questions[`${cid}_link`] = {
      type: "noul",
      instructions: `Should new_card add a [[wikilink]] to candidate ${cid} (${topCandidates[i].slug}) because they share the same specific entity, topic, task, or evolving state?`,
      criteria: {
        true: `Candidate ${cid} is directly relevant to new_card (e.g., updates its state, provides complementary evidence for the same question/topic, or shares a key entity).`,
        false: `Candidate ${cid} is unrelated or only shares superficial/incidental words.`,
      },
    };
    questions[`${cid}_rel`] = {
      type: "choice",
      instructions: `Compare new_card against candidate ${cid} (${topCandidates[i].slug}). Does new_card update/change a specific mutable fact or number mentioned in candidate ${cid}, or are they complementary/unrelated?`,
      criteria: {
        state_update:
          "Both cards mention the same specific personal attribute, count, metric, habit frequency, location, or status, and new_card reports a newer/changed value or updated status over time (even if surrounded by other conversation)",
        complementary:
          "Both cards relate to the same user topic or activity, but new_card only adds orthogonal details without changing or updating any prior count, metric, or status in this candidate",
        contradicts:
          "new_card directly conflicts with this candidate without a temporal update",
        duplicate:
          "new_card repeats the exact same facts without any new information",
        unrelated:
          "new_card and this candidate are about different topics and only share incidental vocabulary",
      },
    };
  }

  const response = await provider.decide(state, questions);
  const actionAns = response.answers.write_action as SystemOneChoiceAnswer | undefined;
  const rawAction = (actionAns?.choice ?? "create") as WriteActionType;

  const candidateDecisions: CandidateLinkDecision[] = [];
  for (let i = 0; i < topCandidates.length; i++) {
    const cid = `c${i}`;
    const c = topCandidates[i];
    const linkAns = response.answers[`${cid}_link`] as SystemOneNoulAnswer | undefined;
    const relAns = response.answers[`${cid}_rel`] as SystemOneChoiceAnswer | undefined;

    const linkProb = linkAns?.noul ?? 0;
    const relation = (relAns?.choice ?? "unrelated") as CandidateRelationType;
    const relationConf = relAns?.confidence ?? 0;

    const shouldLink =
      linkProb >= linkThreshold && relation !== "unrelated";

    candidateDecisions.push({
      slug: c.slug,
      title: c.title,
      lexicalScore: c.score,
      shouldLink,
      linkProbability: linkProb,
      relation,
      relationConfidence: relationConf,
    });
  }

  candidateDecisions.sort((a, b) => b.linkProbability - a.linkProbability);
  const recommendedLinks = candidateDecisions.filter((c) => c.shouldLink);

  const updateTarget = candidateDecisions.find(
    (c) => c.relation === "state_update" && c.shouldLink,
  );

  // Calibrate action: if a candidate is clearly a state_update, surface update
  let finalAction: WriteActionType = rawAction;
  if (updateTarget && finalAction === "create") {
    finalAction = "update";
  }

  return {
    action: finalAction,
    actionConfidence: actionAns?.confidence ?? 0,
    actionProbabilities: actionAns?.probabilities ?? {},
    candidates: candidateDecisions,
    recommendedLinks,
    updateTargetSlug: updateTarget?.slug,
  };
}

export interface RerankedCard {
  slug: string;
  title: string;
  lexicalScore: number;
  relevanceProbability: number;
  utilityScore: number; // 0 to 3
  combinedScore: number;
  keep: boolean;
}

export interface RerankSearchResult {
  ranked: RerankedCard[];
  selected: RerankedCard[];
  sufficientEvidence: boolean;
  sufficientProbability: number;
}

/**
 * Rerank and filter candidate cards for a query using SystemOne (Jev-Mem retrieval controller).
 */
export async function rerankWithSystemOne(
  provider: DecisionProvider,
  query: string,
  candidates: Array<{
    slug: string;
    title: string;
    created?: string;
    content: string;
    lexicalScore: number;
  }>,
  options: {
    excerptChars?: number;
    relevanceThreshold?: number;
    utilityThreshold?: number;
    minKeep?: number;
    maxKeep?: number;
  } = {},
): Promise<RerankSearchResult> {
  if (candidates.length === 0) {
    return {
      ranked: [],
      selected: [],
      sufficientEvidence: false,
      sufficientProbability: 0,
    };
  }

  const excerptChars = options.excerptChars ?? 2400;
  const relevanceThreshold = options.relevanceThreshold ?? 0.25;
  const utilityThreshold = options.utilityThreshold ?? 0.9;
  const minKeep = options.minKeep ?? 1;
  const maxKeep = options.maxKeep ?? 5;

  const state = {
    query,
    candidates: candidates.map((c, idx) => ({
      id: `m${idx}`,
      slug: c.slug,
      title: c.title,
      date: c.created ?? "",
      excerpt: c.content.trim().slice(0, excerptChars),
    })),
  };

  const questions: Record<string, SystemOneQuestion> = {
    sufficient: {
      type: "noul",
      instructions:
        "Do the provided candidate memories contain sufficient information to answer the query without expanding further search hops?",
      criteria: {
        true: "At least one or more candidates directly provide the facts needed to answer the query.",
        false: "The candidates miss key facts needed to answer the query.",
      },
    },
  };

  for (let i = 0; i < candidates.length; i++) {
    const mid = `m${i}`;
    questions[`${mid}_rel`] = {
      type: "noul",
      instructions: `Does candidate memory ${mid} (${candidates[i].slug}) contain evidence or context useful for answering the query?`,
      criteria: {
        true: `Candidate ${mid} contains facts, numbers, events, or preferences needed to answer the query.`,
        false: `Candidate ${mid} is a distractor or about an unrelated topic.`,
      },
    };
    questions[`${mid}_util`] = {
      type: "score",
      instructions: `How useful is candidate memory ${mid} (${candidates[i].slug}) for answering the query?`,
      criteria: [
        "Irrelevant distractor",
        "Tangential background only",
        "Contains partial or supporting evidence",
        "Contains direct key evidence to answer the query",
      ],
    };
  }

  const response = await provider.decide(state, questions);
  const suffAns = response.answers.sufficient as SystemOneNoulAnswer | undefined;
  const suffProb = suffAns?.noul ?? 0;

  const ranked: RerankedCard[] = candidates.map((c, i) => {
    const mid = `m${i}`;
    const relAns = response.answers[`${mid}_rel`] as SystemOneNoulAnswer | undefined;
    const utilAns = response.answers[`${mid}_util`] as SystemOneScoreAnswer | undefined;

    const relProb = relAns?.noul ?? 0;
    const utilScore = utilAns?.score ?? 0; // 0..3
    const combinedScore = 0.6 * relProb + 0.35 * (utilScore / 3) + 0.05 * c.lexicalScore;
    const keep = relProb >= relevanceThreshold || utilScore >= utilityThreshold;

    return {
      slug: c.slug,
      title: c.title,
      lexicalScore: c.lexicalScore,
      relevanceProbability: relProb,
      utilityScore: utilScore,
      combinedScore,
      keep,
    };
  });

  ranked.sort((a, b) => b.combinedScore - a.combinedScore);

  let selected = ranked.filter((r) => r.keep).slice(0, maxKeep);
  if (selected.length < minKeep && ranked.length > 0) {
    selected = ranked.slice(0, minKeep);
  }

  return {
    ranked,
    selected,
    sufficientEvidence: suffProb >= 0.5,
    sufficientProbability: suffProb,
  };
}

export type PairRelationVerdict =
  | "consistent"
  | "state_update"
  | "contradictory"
  | "redundant_merge";

export interface PairInspectionResult {
  slug1: string;
  slug2: string;
  title1: string;
  title2: string;
  verdict: PairRelationVerdict;
  confidence: number;
  probabilities: Record<string, number>;
  needsAttention: boolean;
  attentionProbability: number;
}

/**
 * Inspect card pairs surfaced by `memex organize` using SystemOne to distinguish
 * benign co-occurrence from state updates, contradictions, or duplicates.
 */
export async function inspectPairsWithSystemOne(
  provider: DecisionProvider,
  pairs: Array<{
    slug1: string;
    slug2: string;
    title1: string;
    title2: string;
    created1?: string;
    created2?: string;
    content1: string;
    content2: string;
  }>,
  options: { excerptChars?: number } = {},
): Promise<PairInspectionResult[]> {
  if (pairs.length === 0) return [];
  const excerptChars = options.excerptChars ?? 2400;

  const state = {
    card_pairs: pairs.map((p, idx) => ({
      id: `p${idx}`,
      card_a: {
        slug: p.slug1,
        title: p.title1,
        date: p.created1 ?? "",
        excerpt: p.content1.trim().slice(0, excerptChars),
      },
      card_b: {
        slug: p.slug2,
        title: p.title2,
        date: p.created2 ?? "",
        excerpt: p.content2.trim().slice(0, excerptChars),
      },
    })),
  };

  const questions: Record<string, SystemOneQuestion> = {};
  for (let i = 0; i < pairs.length; i++) {
    const pid = `p${i}`;
    questions[`${pid}_verdict`] = {
      type: "choice",
      instructions: `Compare card_a and card_b in pair ${pid}. What is their relationship regarding memory consistency and evolution?`,
      criteria: {
        consistent:
          "The two cards cover complementary or distinct aspects without conflicting or superseding each other",
        state_update:
          "One card updates, changes, or supersedes a mutable fact, metric, preference, or status in the other card over time",
        contradictory:
          "The two cards make incompatible claims that conflict with each other",
        redundant_merge:
          "The two cards repeat the same insight and should be merged",
      },
    };
    questions[`${pid}_attn`] = {
      type: "noul",
      instructions: `Does pair ${pid} require memory consolidation (because one card updates, contradicts, or duplicates a fact in the other)?`,
      criteria: {
        true: "Yes, one card updates, supersedes, contradicts, or duplicates a specific fact in the other card.",
        false: "No, they are simply consistent complementary notes that do not conflict or override each other.",
      },
    };
  }

  const response = await provider.decide(state, questions);

  return pairs.map((p, i) => {
    const pid = `p${i}`;
    const vAns = response.answers[`${pid}_verdict`] as SystemOneChoiceAnswer | undefined;
    const aAns = response.answers[`${pid}_attn`] as SystemOneNoulAnswer | undefined;

    const verdict = (vAns?.choice ?? "consistent") as PairRelationVerdict;
    const attnProb = aAns?.noul ?? 0;
    const needsAttention = verdict !== "consistent" || attnProb >= 0.55;

    return {
      slug1: p.slug1,
      slug2: p.slug2,
      title1: p.title1,
      title2: p.title2,
      verdict,
      confidence: vAns?.confidence ?? 0,
      probabilities: vAns?.probabilities ?? {},
      needsAttention,
      attentionProbability: attnProb,
    };
  });
}
