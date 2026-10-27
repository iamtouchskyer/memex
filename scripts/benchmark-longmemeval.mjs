/**
 * LongMemEval Benchmark Suite for Memex: Before (v0.4.1 Lexical) vs. After (+ SystemOne Decision API)
 *
 * Evaluates three memory lifecycle capabilities inspired by Jev-Mem (arXiv:2609.23986v1):
 *   1. Retrieval Reranking & Context Compression (on LongMemEval_S 24-case panel)
 *   2. Write-time Action & Link Prediction (on LongMemEval knowledge-update & multi-session cases)
 *   3. Organize Pair Inspection (on LongMemEval knowledge-update vs. normal complementary pairs)
 *
 * Configuration is resolved strictly via user-provided env / config files (no hardcoded endpoints).
 */
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../dist/lib/store.js";
import { parseFrontmatter, stringifyFrontmatter, extractLinks } from "../dist/lib/parser.js";
import { tokenizeQuery, buildSearchableFields, scoreCard, sortScoredMatches } from "../dist/lib/scoring.js";
import { suggestLinks } from "../dist/lib/suggest-links.js";
import {
  createDecisionProvider,
  evaluateWriteWithSystemOne,
  rerankWithSystemOne,
  inspectPairsWithSystemOne,
} from "../dist/lib/systemone.js";

const LME_S_PATH = process.env.LME_S_PATH;
const PROTOCOL_24_PATH = process.env.LME_PROTOCOL_PATH;
const KEY_FILE = process.env.MEMEX_DECISION_API_KEY_FILE;

function formatSessionCard(session, dateStr) {
  const userLines = [];
  const assistantLines = [];
  for (const turn of session) {
    if (turn.role === "user") {
      userLines.push(`User: ${turn.content.trim()}`);
    } else if (turn.role === "assistant") {
      assistantLines.push(`Assistant: ${turn.content.trim().slice(0, 1200)}`);
    }
  }
  const header = dateStr ? `Session Date: ${dateStr}\n\n` : "";
  return `${header}${userLines.join("\n\n")}\n\n---\n${assistantLines.join("\n")}`;
}

function firstUserTitle(session, fallback) {
  const u = session.find((t) => t.role === "user");
  if (!u || !u.content) return fallback;
  const clean = u.content.replace(/\s+/g, " ").trim().slice(0, 56);
  return clean || fallback;
}

function toIsoDate(lmeDate) {
  // e.g. "2023/05/23 (Tue) 13:01" -> "2023-05-23"
  const m = String(lmeDate || "").match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "2023-01-01";
}

function computeRecallAtK(rankedSlugs, goldSet, k) {
  if (goldSet.size === 0) return 1;
  const topK = rankedSlugs.slice(0, k);
  let hits = 0;
  for (const s of topK) {
    if (goldSet.has(s)) hits++;
  }
  return hits / goldSet.size;
}

function computePrecisionAtK(rankedSlugs, goldSet, k) {
  const topK = rankedSlugs.slice(0, k);
  if (topK.length === 0) return 0;
  let hits = 0;
  for (const s of topK) {
    if (goldSet.has(s)) hits++;
  }
  return hits / topK.length;
}

function computeMRR(rankedSlugs, goldSet) {
  for (let i = 0; i < rankedSlugs.length; i++) {
    if (goldSet.has(rankedSlugs[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function computeNDCGAtK(rankedSlugs, goldSet, k) {
  const topK = rankedSlugs.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (goldSet.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const idealHits = Math.min(k, goldSet.size);
  if (idealHits === 0) return 0;
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return dcg / idcg;
}

async function runRetrievalBenchmark(provider, sMap, qids) {
  console.log(`\n=== Task 1: Retrieval & Context Gating Benchmark (${qids.length} LongMemEval_S questions) ===`);
  const rows = [];

  for (const qid of qids) {
    const item = sMap.get(qid);
    if (!item) continue;

    const tmpDir = await mkdtemp(join(tmpdir(), `memex-bench-ret-${qid}-`));
    try {
      const cardsDir = join(tmpDir, "cards");
      const archiveDir = join(tmpDir, "archive");
      await mkdir(cardsDir, { recursive: true });
      await mkdir(archiveDir, { recursive: true });
      const store = new CardStore(cardsDir, archiveDir);

      const cardChars = new Map();
      const sessionIds = item.haystack_session_ids;
      const dates = item.haystack_dates;
      const sessions = item.haystack_sessions;

      for (let i = 0; i < sessionIds.length; i++) {
        const slug = sessionIds[i].toLowerCase().replace(/[^a-z0-9-_]/g, "-");
        const body = formatSessionCard(sessions[i], dates[i]);
        const title = firstUserTitle(sessions[i], slug);
        const created = toIsoDate(dates[i]);
        const raw = stringifyFrontmatter(body, {
          title,
          created,
          source: "longmemeval",
        });
        await store.writeCard(slug, raw);
        cardChars.set(slug, body.length);
      }

      const goldSet = new Set(
        item.answer_session_ids.map((s) => s.toLowerCase().replace(/[^a-z0-9-_]/g, "-")),
      );

      // Before: Native Memex v0.4.1 Lexical Search
      const { tokens, originalTokens } = tokenizeQuery(item.question);
      const allCards = await store.scanAll();
      const scored = [];
      for (const c of allCards) {
        const raw = await store.readCard(c.slug);
        const { data, content } = parseFrontmatter(raw);
        const fields = buildSearchableFields(c.slug, data, content, extractLinks(content));
        const match = scoreCard(tokens, originalTokens, fields);
        if (match) scored.push(match);
      }
      sortScoredMatches(scored);

      const beforeRanked = scored.map((m) => m.slug);
      const beforeTop5 = beforeRanked.slice(0, 5);
      const beforeCharsTop5 = beforeTop5.reduce((acc, s) => acc + (cardChars.get(s) ?? 0), 0);

      // After: Memex + SystemOne Rerank & Gate on top-18 lexical pool
      const poolMatches = scored.slice(0, 18);
      const candidateInputs = [];
      for (const m of poolMatches) {
        const raw = await store.readCard(m.slug);
        const { data, content } = parseFrontmatter(raw);
        candidateInputs.push({
          slug: m.slug,
          title: String(data.title || m.slug),
          created: String(data.created || ""),
          content,
          lexicalScore: m.score,
        });
      }

      const t0 = Date.now();
      const rerankRes = await rerankWithSystemOne(provider, item.question, candidateInputs, {
        excerptChars: 2400,
        relevanceThreshold: 0.25,
        utilityThreshold: 0.9,
        minKeep: 1,
        maxKeep: 5,
      });
      const latencyMs = Date.now() - t0;

      const afterRanked = rerankRes.ranked.map((r) => r.slug);
      const afterSelected = rerankRes.selected.map((r) => r.slug);
      const afterCharsSelected = afterSelected.reduce((acc, s) => acc + (cardChars.get(s) ?? 0), 0);

      const row = {
        qid,
        type: item.question_type,
        totalSessions: sessionIds.length,
        goldCount: goldSet.size,
        goldSlugs: [...goldSet],
        poolRecall18: computeRecallAtK(beforeRanked, goldSet, 18),
        beforeTop5Slugs: beforeTop5,
        afterTop5Slugs: afterRanked.slice(0, 5),
        afterSelectedSlugs: afterSelected,
        before: {
          mrr: computeMRR(beforeRanked, goldSet),
          recall1: computeRecallAtK(beforeRanked, goldSet, 1),
          recall3: computeRecallAtK(beforeRanked, goldSet, 3),
          recall5: computeRecallAtK(beforeRanked, goldSet, 5),
          precision3: computePrecisionAtK(beforeRanked, goldSet, 3),
          precision5: computePrecisionAtK(beforeRanked, goldSet, 5),
          ndcg5: computeNDCGAtK(beforeRanked, goldSet, 5),
          contextChars: beforeCharsTop5,
        },
        after: {
          mrr: computeMRR(afterRanked, goldSet),
          recall1: computeRecallAtK(afterRanked, goldSet, 1),
          recall3: computeRecallAtK(afterRanked, goldSet, 3),
          recall5: computeRecallAtK(afterRanked, goldSet, 5),
          selectedRecall: computeRecallAtK(afterSelected, goldSet, afterSelected.length),
          precision3: computePrecisionAtK(afterRanked, goldSet, 3),
          selectedPrecision: computePrecisionAtK(afterSelected, goldSet, afterSelected.length),
          ndcg5: computeNDCGAtK(afterRanked, goldSet, 5),
          selectedCount: afterSelected.length,
          contextChars: afterCharsSelected,
          latencyMs,
        },
      };
      rows.push(row);
      console.log(
        `  [${qid}] (${item.question_type}) MRR: ${row.before.mrr.toFixed(2)} -> ${row.after.mrr.toFixed(2)} | R@3: ${row.before.recall3.toFixed(2)} -> ${row.after.recall3.toFixed(2)} | P(sel): ${row.before.precision5.toFixed(2)} -> ${row.after.selectedPrecision.toFixed(2)} | chars: ${row.before.contextChars} -> ${row.after.contextChars} (${latencyMs}ms)`,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return rows;
}

async function runWriteAndLinkBenchmark(provider, sData) {
  // Select 12 knowledge-update cases + 8 multi-session cases from LongMemEval_S
  const kuCases = sData
    .filter((x) => x.question_type === "knowledge-update" && !x.question_id.endsWith("_abs") && x.answer_session_ids.length === 2)
    .slice(0, 12);
  const msCases = sData
    .filter((x) => x.question_type === "multi-session" && !x.question_id.endsWith("_abs") && x.answer_session_ids.length >= 2)
    .slice(0, 8);
  const testCases = [...kuCases, ...msCases];

  console.log(`\n=== Task 2: Write-Time Action & Link Prediction Benchmark (${testCases.length} cases: 12 knowledge-update + 8 multi-session) ===`);
  const rows = [];

  for (const item of testCases) {
    const qid = item.question_id;
    const isUpdateCase = item.question_type === "knowledge-update";
    const expectedAction = isUpdateCase ? "update" : "create";

    const tmpDir = await mkdtemp(join(tmpdir(), `memex-bench-write-${qid}-`));
    try {
      const cardsDir = join(tmpDir, "cards");
      const archiveDir = join(tmpDir, "archive");
      await mkdir(cardsDir, { recursive: true });
      await mkdir(archiveDir, { recursive: true });
      const store = new CardStore(cardsDir, archiveDir);

      // Pair the answer sessions ordered by date: earlier session(s) are already in store,
      // latest answer session is being newly written, alongside 15 distractor sessions from the same user.
      const sessionIds = item.haystack_session_ids;
      const dates = item.haystack_dates;
      const sessions = item.haystack_sessions;

      const ansIndices = item.answer_session_ids
        .map((aid) => sessionIds.indexOf(aid))
        .filter((idx) => idx >= 0)
        .sort((a, b) => toIsoDate(dates[a]).localeCompare(toIsoDate(dates[b])));

      const newIdx = ansIndices[ansIndices.length - 1];
      const priorGoldIndices = ansIndices.slice(0, -1);
      const priorGoldSlugs = new Set(
        priorGoldIndices.map((idx) => sessionIds[idx].toLowerCase().replace(/[^a-z0-9-_]/g, "-")),
      );

      // Pick 15 distractor sessions from the same user
      const distractorIndices = [];
      for (let i = 0; i < sessionIds.length && distractorIndices.length < 15; i++) {
        if (!ansIndices.includes(i)) distractorIndices.push(i);
      }

      for (const idx of [...priorGoldIndices, ...distractorIndices]) {
        const slug = sessionIds[idx].toLowerCase().replace(/[^a-z0-9-_]/g, "-");
        const body = formatSessionCard(sessions[idx], dates[idx]);
        const title = firstUserTitle(sessions[idx], slug);
        const created = toIsoDate(dates[idx]);
        await store.writeCard(
          slug,
          stringifyFrontmatter(body, { title, created, source: "longmemeval" }),
        );
      }

      // Now evaluate writing the new session
      const newSlug = sessionIds[newIdx].toLowerCase().replace(/[^a-z0-9-_]/g, "-");
      const newBody = formatSessionCard(sessions[newIdx], dates[newIdx]);
      const newTitle = firstUserTitle(sessions[newIdx], newSlug);
      const newCreated = toIsoDate(dates[newIdx]);
      const newData = { title: newTitle, created: newCreated, source: "longmemeval" };

      // Before: Memex v0.4.1 suggestLinks
      const beforeLinks = await suggestLinks(store, newSlug, newData, newBody);
      const beforeAction = "create"; // v0.4.1 always creates

      // After: SystemOne Write Controller
      const t0 = Date.now();
      const afterDecision = await evaluateWriteWithSystemOne(
        store,
        provider,
        newSlug,
        newData,
        newBody,
        { candidateLimit: 6, linkThreshold: 0.25, excerptChars: 2200 },
      );
      const latencyMs = Date.now() - t0;
      const afterLinks = afterDecision.recommendedLinks.map((l) => l.slug);

      const calcLinkMetrics = (predicted) => {
        const hits = predicted.filter((s) => priorGoldSlugs.has(s)).length;
        const prec = predicted.length > 0 ? hits / predicted.length : (priorGoldSlugs.size === 0 ? 1 : 0);
        const rec = priorGoldSlugs.size > 0 ? hits / priorGoldSlugs.size : 1;
        const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
        return { hits, predictedCount: predicted.length, precision: prec, recall: rec, f1 };
      };

      const bm = calcLinkMetrics(beforeLinks);
      const am = calcLinkMetrics(afterLinks);

      const row = {
        qid,
        type: item.question_type,
        expectedAction,
        beforeAction,
        afterAction: afterDecision.action,
        beforeActionCorrect: beforeAction === expectedAction,
        afterActionCorrect: afterDecision.action === expectedAction,
        priorGoldSlugs: [...priorGoldSlugs],
        beforeLinks,
        afterLinks,
        afterCandidates: afterDecision.candidates,
        beforeMetrics: bm,
        afterMetrics: am,
        latencyMs,
      };
      rows.push(row);
      console.log(
        `  [${qid}] (${item.question_type}) Action: exp=${expectedAction} before=${beforeAction} after=${afterDecision.action} | Link F1: ${bm.f1.toFixed(2)} -> ${am.f1.toFixed(2)} (${latencyMs}ms)`,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return rows;
}

async function runOrganizeBenchmark(provider, sData) {
  // Construct 20 connected card pairs:
  // 10 positive pairs from knowledge-update (old session <-> updated session, requiring state_update consolidation)
  // 10 negative pairs from multi-session (complementary sessions that do NOT supersede/conflict with each other)
  const kuCases = sData
    .filter((x) => x.question_type === "knowledge-update" && !x.question_id.endsWith("_abs") && x.answer_session_ids.length === 2)
    .slice(0, 10);
  const msCases = sData
    .filter((x) => x.question_type === "multi-session" && !x.question_id.endsWith("_abs") && x.answer_session_ids.length >= 2)
    .slice(0, 10);

  console.log(`\n=== Task 3: Organize Pair Inspection Benchmark (20 pairs: 10 state-update pairs + 10 consistent complementary pairs) ===`);

  const pairs = [];
  const goldNeedsConsolidation = [];

  for (const item of kuCases) {
    const i1 = item.haystack_session_ids.indexOf(item.answer_session_ids[0]);
    const i2 = item.haystack_session_ids.indexOf(item.answer_session_ids[1]);
    if (i1 < 0 || i2 < 0) continue;
    pairs.push({
      qid: item.question_id,
      slug1: `${item.question_id}-old`,
      slug2: `${item.question_id}-new`,
      title1: firstUserTitle(item.haystack_sessions[i1], "old"),
      title2: firstUserTitle(item.haystack_sessions[i2], "new"),
      created1: toIsoDate(item.haystack_dates[i1]),
      created2: toIsoDate(item.haystack_dates[i2]),
      content1: formatSessionCard(item.haystack_sessions[i1], item.haystack_dates[i1]),
      content2: formatSessionCard(item.haystack_sessions[i2], item.haystack_dates[i2]),
    });
    goldNeedsConsolidation.push(true);
  }

  for (const item of msCases) {
    const i1 = item.haystack_session_ids.indexOf(item.answer_session_ids[0]);
    const i2 = item.haystack_session_ids.indexOf(item.answer_session_ids[1]);
    if (i1 < 0 || i2 < 0) continue;
    pairs.push({
      qid: item.question_id,
      slug1: `${item.question_id}-part1`,
      slug2: `${item.question_id}-part2`,
      title1: firstUserTitle(item.haystack_sessions[i1], "part1"),
      title2: firstUserTitle(item.haystack_sessions[i2], "part2"),
      created1: toIsoDate(item.haystack_dates[i1]),
      created2: toIsoDate(item.haystack_dates[i2]),
      content1: formatSessionCard(item.haystack_sessions[i1], item.haystack_dates[i1]),
      content2: formatSessionCard(item.haystack_sessions[i2], item.haystack_dates[i2]),
    });
    goldNeedsConsolidation.push(false);
  }

  const t0 = Date.now();
  const decisions = await inspectPairsWithSystemOne(provider, pairs, { excerptChars: 2200 });
  const latencyMs = Date.now() - t0;

  // Before: memex organize dumps all 20 recentPairs indiscriminately for contradiction check (100% flagged)
  // After: SystemOne classifies each pair
  let afterTP = 0, afterFP = 0, afterTN = 0, afterFN = 0;
  const details = [];

  for (let i = 0; i < pairs.length; i++) {
    const gold = goldNeedsConsolidation[i];
    const d = decisions[i];
    const pred = d.verdict === "state_update" || d.verdict === "contradictory" || d.verdict === "redundant_merge";
    if (gold && pred) afterTP++;
    else if (!gold && pred) afterFP++;
    else if (!gold && !pred) afterTN++;
    else if (gold && !pred) afterFN++;

    details.push({
      qid: pairs[i].qid,
      goldNeedsConsolidation: gold,
      verdict: d.verdict,
      confidence: d.confidence,
      attentionProbability: d.attentionProbability,
      predictedPositive: pred,
    });
    console.log(
      `  Pair ${i + 1} [${pairs[i].qid}] gold=${gold ? "UPDATE" : "CONSISTENT"} -> pred=${d.verdict} (conf=${d.confidence.toFixed(2)}, attn=${d.attentionProbability.toFixed(2)})`,
    );
  }

  const beforePrecision = 10 / 20; // flags all 20 pairs
  const beforeRecall = 1.0;
  const beforeF1 = (2 * beforePrecision * beforeRecall) / (beforePrecision + beforeRecall);

  const afterPrecision = afterTP + afterFP > 0 ? afterTP / (afterTP + afterFP) : 0;
  const afterRecall = afterTP + afterFN > 0 ? afterTP / (afterTP + afterFN) : 0;
  const afterF1 = afterPrecision + afterRecall > 0 ? (2 * afterPrecision * afterRecall) / (afterPrecision + afterRecall) : 0;
  const afterAcc = (afterTP + afterTN) / pairs.length;

  return {
    totalPairs: pairs.length,
    latencyMs,
    before: { precision: beforePrecision, recall: beforeRecall, f1: beforeF1, accuracy: 0.5, falseAlarmRate: 1.0 },
    after: {
      tp: afterTP,
      fp: afterFP,
      tn: afterTN,
      fn: afterFN,
      precision: afterPrecision,
      recall: afterRecall,
      f1: afterF1,
      accuracy: afterAcc,
      falseAlarmRate: afterFP / 10,
    },
    details,
  };
}

function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main() {
  console.log("Loading LongMemEval_S and 24-question protocol...");
  const sData = JSON.parse(await readFile(LME_S_PATH, "utf-8"));
  const proto = JSON.parse(await readFile(PROTOCOL_24_PATH, "utf-8"));
  const qids = proto.cases.map((c) => c.question_id);
  const sMap = new Map(sData.map((x) => [x.question_id, x]));

  const provider = createDecisionProvider({ apiKeyPath: KEY_FILE });

  const retRows = await runRetrievalBenchmark(provider, sMap, qids);
  const writeRows = await runWriteAndLinkBenchmark(provider, sData);
  const orgResult = await runOrganizeBenchmark(provider, sData);

  const summary = {
    timestamp: new Date().toISOString(),
    dataset: "LongMemEval_S (cleaned)",
    model: "microsoft-decision-1 (decision-icebox-9b)",
    task1_retrieval_24cases: {
      cases: retRows.length,
      before_v041_lexical: {
        mrr: avg(retRows.map((r) => r.before.mrr)),
        recallAt1: avg(retRows.map((r) => r.before.recall1)),
        recallAt3: avg(retRows.map((r) => r.before.recall3)),
        recallAt5: avg(retRows.map((r) => r.before.recall5)),
        precisionAt3: avg(retRows.map((r) => r.before.precision3)),
        precisionAt5: avg(retRows.map((r) => r.before.precision5)),
        ndcgAt5: avg(retRows.map((r) => r.before.ndcg5)),
        avgContextChars: avg(retRows.map((r) => r.before.contextChars)),
      },
      after_systemone_rerank: {
        mrr: avg(retRows.map((r) => r.after.mrr)),
        recallAt1: avg(retRows.map((r) => r.after.recall1)),
        recallAt3: avg(retRows.map((r) => r.after.recall3)),
        recallAt5: avg(retRows.map((r) => r.after.recall5)),
        selectedRecall: avg(retRows.map((r) => r.after.selectedRecall)),
        precisionAt3: avg(retRows.map((r) => r.after.precision3)),
        selectedPrecision: avg(retRows.map((r) => r.after.selectedPrecision)),
        ndcgAt5: avg(retRows.map((r) => r.after.ndcg5)),
        avgSelectedCards: avg(retRows.map((r) => r.after.selectedCount)),
        avgContextChars: avg(retRows.map((r) => r.after.contextChars)),
        contextCharReductionPct:
          (1 -
            avg(retRows.map((r) => r.after.contextChars)) /
              avg(retRows.map((r) => r.before.contextChars))) *
          100,
        avgLatencyMs: avg(retRows.map((r) => r.after.latencyMs)),
      },
      rows: retRows,
    },
    task2_write_and_link_20cases: {
      cases: writeRows.length,
      before_v041_suggestLinks: {
        actionAccuracy: avg(writeRows.map((r) => (r.beforeActionCorrect ? 1 : 0))),
        updateDetectionRecall: avg(
          writeRows.filter((r) => r.expectedAction === "update").map((r) => (r.beforeActionCorrect ? 1 : 0)),
        ),
        linkPrecision: avg(writeRows.map((r) => r.beforeMetrics.precision)),
        linkRecall: avg(writeRows.map((r) => r.beforeMetrics.recall)),
        linkF1: avg(writeRows.map((r) => r.beforeMetrics.f1)),
      },
      after_systemone_write: {
        actionAccuracy: avg(writeRows.map((r) => (r.afterActionCorrect ? 1 : 0))),
        updateDetectionRecall: avg(
          writeRows.filter((r) => r.expectedAction === "update").map((r) => (r.afterActionCorrect ? 1 : 0)),
        ),
        linkPrecision: avg(writeRows.map((r) => r.afterMetrics.precision)),
        linkRecall: avg(writeRows.map((r) => r.afterMetrics.recall)),
        linkF1: avg(writeRows.map((r) => r.afterMetrics.f1)),
        avgLatencyMs: avg(writeRows.map((r) => r.latencyMs)),
      },
      rows: writeRows,
    },
    task3_organize_pairs_20: orgResult,
  };

  const outPath = process.env.MEMEX_BENCH_JSON_PATH ?? "memex-systemone-benchmark.json";
  await writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nSaved full benchmark results to ${outPath}`);
  console.log("\n=== SUMMARY ===");
  console.log("Task 1 (Retrieval):", JSON.stringify({
    before: summary.task1_retrieval_24cases.before_v041_lexical,
    after: summary.task1_retrieval_24cases.after_systemone_rerank,
  }, null, 2));
  console.log("Task 2 (Write & Link):", JSON.stringify({
    before: summary.task2_write_and_link_20cases.before_v041_suggestLinks,
    after: summary.task2_write_and_link_20cases.after_systemone_write,
  }, null, 2));
  console.log("Task 3 (Organize):", JSON.stringify({
    before: summary.task3_organize_pairs_20.before,
    after: summary.task3_organize_pairs_20.after,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
