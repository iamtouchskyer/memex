/**
 * End-to-End Reader QA & Judge Benchmark for Memex on LongMemEval_S (24-question panel)
 *
 * Compares 3 retrieval conditions fed into the exact same Reader (`gpt-5.6-sol`)
 * and scored by the official LongMemEval Judge (`get_anscheck_prompt`):
 *   1. before_top5: Memex v0.4.1 native lexical Top-5 cards
 *   2. after_top5:  Memex + SystemOne reranked Top-5 cards
 *   3. after_gated: Memex + SystemOne gated/selected cards (avg 1.71 cards)
 */
import { readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parseKeyFromEnvFile } from "../dist/lib/systemone.js";

const BENCH_JSON_PATH =
  process.env.MEMEX_BENCH_JSON_PATH ?? "memex-systemone-benchmark.json";
const LME_S_PATH = process.env.LME_S_PATH;
const KEY_FILE = process.env.MEMEX_DECISION_API_KEY_FILE;
const READER_MODEL = process.env.MEMEX_BENCH_READER_MODEL ?? "gpt-5.6-sol";
const JUDGE_MODEL = process.env.MEMEX_BENCH_JUDGE_MODEL ?? "gpt-5.6-sol";

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

function buildReaderPrompt(cardsText, questionDate, question) {
  return (
    "I will give you several history chats between you and a user. Please answer the question based on the relevant chat history.\n\n" +
    "History Chats:\n\n" +
    cardsText +
    `\n\nCurrent Date: ${questionDate}\nQuestion: ${question}\nAnswer (think step by step and conclude with the direct final answer):`
  );
}

function getOfficialJudgePrompt(task, question, answer, response, abstention = false) {
  if (!abstention) {
    if (["single-session-user", "single-session-assistant", "multi-session"].includes(task)) {
      return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
    } else if (task === "temporal-reasoning") {
      return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
    } else if (task === "knowledge-update") {
      return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
    } else if (task === "single-session-preference") {
      return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: ${question}\n\nRubric: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
    }
    throw new Error(`Unknown task: ${task}`);
  } else {
    return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: ${question}\n\nExplanation: ${answer}\n\nModel Response: ${response}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
}

function callResponsesApi(baseUrl, apiKey, model, prompt, maxOutputTokens = 1024) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/$/, "");
    const reqPath = cleanPath.endsWith("/v1") ? `${cleanPath}/responses` : `${cleanPath}/v1/responses`;
    const body = JSON.stringify({
      model,
      input: [{ role: "user", content: prompt }],
      temperature: 0,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: "none" },
    });

    const reqFn = parsed.protocol === "http:" ? httpRequest : httpsRequest;
    const req = reqFn(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: reqPath,
        method: "POST",
        timeout: 60000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const texts = [];
            for (const item of json.output ?? []) {
              if (item.type === "message" && item.role === "assistant") {
                for (const part of item.content ?? []) {
                  if (part.type === "output_text" && typeof part.text === "string") {
                    texts.push(part.text);
                  }
                }
              }
            }
            resolve({
              text: texts.join("\n").trim(),
              usage: json.usage ?? {},
            });
          } catch (e) {
            reject(new Error(`Parse error: ${e}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main() {
  const envContent = await readFile(KEY_FILE, "utf-8");
  const { apiKey, baseUrl } = parseKeyFromEnvFile(envContent);
  if (!apiKey || !baseUrl) {
    throw new Error("Missing apiKey or baseUrl in KEY_FILE");
  }

  const bench = JSON.parse(await readFile(BENCH_JSON_PATH, "utf-8"));
  const sData = JSON.parse(await readFile(LME_S_PATH, "utf-8"));
  const sMap = new Map(sData.map((x) => [x.question_id, x]));

  const retRows = bench.task1_retrieval_24cases.rows;
  console.log(`Running E2E Reader QA + Official Judge on ${retRows.length} questions (3 arms each = ${retRows.length * 3} reader + ${retRows.length * 3} judge calls)...`);

  const e2eRows = await runWithConcurrency(retRows, 4, async (row) => {
    const item = sMap.get(row.qid);
    const abstention = row.qid.endsWith("_abs");

    // Map slug -> formatted card body & date
    const cardMap = new Map();
    for (let i = 0; i < item.haystack_session_ids.length; i++) {
      const slug = item.haystack_session_ids[i].toLowerCase().replace(/[^a-z0-9-_]/g, "-");
      const dateStr = item.haystack_dates[i];
      const body = formatSessionCard(item.haystack_sessions[i], dateStr);
      cardMap.set(slug, { slug, dateStr, body });
    }

    const arms = {
      before_top5: row.beforeTop5Slugs,
      after_top5: row.afterTop5Slugs,
      after_gated: row.afterSelectedSlugs,
    };

    const armResults = {};
    for (const [armName, slugs] of Object.entries(arms)) {
      const cardsText = slugs
        .map((s, idx) => {
          const c = cardMap.get(s);
          return c ? `### Memory Card ${idx + 1} (${c.slug}, ${c.dateStr}):\n${c.body}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

      const readerPrompt = buildReaderPrompt(cardsText, item.question_date, item.question);
      const readerResp = await callResponsesApi(baseUrl, apiKey, READER_MODEL, readerPrompt, 1024);

      const judgePrompt = getOfficialJudgePrompt(
        item.question_type,
        item.question,
        item.answer,
        readerResp.text,
        abstention,
      );
      const judgeResp = await callResponsesApi(baseUrl, apiKey, JUDGE_MODEL, judgePrompt, 64);
      const correct = judgeResp.text.toLowerCase().includes("yes") ? 1 : 0;

      armResults[armName] = {
        slugs,
        cardCount: slugs.length,
        inputTokens: readerResp.usage.input_tokens ?? 0,
        outputTokens: readerResp.usage.output_tokens ?? 0,
        totalTokens: (readerResp.usage.input_tokens ?? 0) + (readerResp.usage.output_tokens ?? 0),
        hypothesis: readerResp.text,
        judgeText: judgeResp.text,
        score: correct,
      };
    }

    console.log(
      `  [${row.qid}] (${row.type}) QA Score: Before(Top5)=${armResults.before_top5.score} (${armResults.before_top5.inputTokens} tok) | After(Top5)=${armResults.after_top5.score} (${armResults.after_top5.inputTokens} tok) | After(Gated)=${armResults.after_gated.score} (${armResults.after_gated.inputTokens} tok)`,
    );

    return {
      qid: row.qid,
      type: row.type,
      abstention,
      question: item.question,
      goldAnswer: item.answer,
      before_top5: armResults.before_top5,
      after_top5: armResults.after_top5,
      after_gated: armResults.after_gated,
    };
  });

  const summarizeArm = (key) => ({
    qaAccuracy: avg(e2eRows.map((r) => r[key].score)),
    correctCount: e2eRows.reduce((acc, r) => acc + r[key].score, 0),
    totalQuestions: e2eRows.length,
    avgCards: avg(e2eRows.map((r) => r[key].cardCount)),
    avgInputTokens: avg(e2eRows.map((r) => r[key].inputTokens)),
    avgOutputTokens: avg(e2eRows.map((r) => r[key].outputTokens)),
    avgTotalTokens: avg(e2eRows.map((r) => r[key].totalTokens)),
  });

  const beforeSummary = summarizeArm("before_top5");
  const afterTop5Summary = summarizeArm("after_top5");
  const afterGatedSummary = summarizeArm("after_gated");

  bench.task4_e2e_reader_qa_24cases = {
    readerModel: READER_MODEL,
    judgeModel: JUDGE_MODEL,
    before_v041_lexical_top5: beforeSummary,
    after_systemone_top5: afterTop5Summary,
    after_systemone_gated: {
      ...afterGatedSummary,
      inputTokenReductionVsBeforePct:
        (1 - afterGatedSummary.avgInputTokens / beforeSummary.avgInputTokens) * 100,
      totalTokenReductionVsBeforePct:
        (1 - afterGatedSummary.avgTotalTokens / beforeSummary.avgTotalTokens) * 100,
    },
    rows: e2eRows,
  };

  await writeFile(BENCH_JSON_PATH, JSON.stringify(bench, null, 2), "utf-8");
  console.log("\n=== E2E READER QA SUMMARY (24 LongMemEval_S questions) ===");
  console.log(JSON.stringify({
    before_v041_lexical_top5: bench.task4_e2e_reader_qa_24cases.before_v041_lexical_top5,
    after_systemone_top5: bench.task4_e2e_reader_qa_24cases.after_systemone_top5,
    after_systemone_gated: bench.task4_e2e_reader_qa_24cases.after_systemone_gated,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
