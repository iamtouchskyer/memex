import { parseFrontmatter, stringifyFrontmatter } from "../lib/parser.js";
import { CardStore } from "../lib/store.js";
import { prepareMemexInput } from "../lib/sensitive-input.js";
import { suggestLinks } from "../lib/suggest-links.js";
import type { MemexConfig } from "../lib/config.js";
import {
  createDecisionProvider,
  evaluateWriteWithSystemOne,
  type DecisionProvider,
  type WriteDecisionResult,
} from "../lib/systemone.js";

const REQUIRED_FIELDS = ["title", "created", "source"];

export interface WriteOptions {
  config?: MemexConfig;
  decision?: boolean;
  _decisionProvider?: DecisionProvider;
}

interface WriteResult {
  success: boolean;
  error?: string;
  warnings?: string[];
  decision?: WriteDecisionResult;
}

export async function writeCommand(
  store: CardStore,
  slug: string,
  input: string,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const safety = prepareMemexInput(input, "content");
  if (!safety.ok) return { success: false, error: safety.error };

  const { data, content } = parseFrontmatter(safety.text);

  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length > 0) {
    return { success: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  // Normalize all date fields to YYYY-MM-DD strings
  const today = new Date().toISOString().split("T")[0];
  data.modified = today;
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }

  const output = stringifyFrontmatter(content, data);
  const isNew = !(await store.resolve(slug));
  await store.writeCard(slug, output);

  const warnings = [...(safety.warnings ?? [])];
  let decisionResult: WriteDecisionResult | undefined;

  const useDecision =
    options.decision === true ||
    options.config?.experimental?.systemOneMemory === true ||
    Boolean(options._decisionProvider);

  if (isNew) {
    if (useDecision) {
      try {
        const provider =
          options._decisionProvider ??
          createDecisionProvider({
            apiKey: options.config?.decisionApiKey,
            apiKeyPath: options.config?.decisionApiKeyPath,
            baseUrl: options.config?.decisionBaseUrl,
            model: options.config?.decisionModel,
          });
        decisionResult = await evaluateWriteWithSystemOne(
          store,
          provider,
          slug,
          data,
          content,
        );
        if (decisionResult.action === "update" && decisionResult.updateTargetSlug) {
          warnings.push(
            `SystemOne decision: updates existing card [[${decisionResult.updateTargetSlug}]] (confidence: ${decisionResult.actionConfidence.toFixed(2)})`,
          );
        } else if (decisionResult.action === "skip_duplicate") {
          warnings.push(
            `SystemOne decision: potential duplicate of existing card (confidence: ${decisionResult.actionConfidence.toFixed(2)})`,
          );
        }
        if (decisionResult.recommendedLinks.length > 0) {
          const linkDesc = decisionResult.recommendedLinks
            .map((l) => `[[${l.slug}]] (${l.relation}, p=${l.linkProbability.toFixed(2)})`)
            .join(" ");
          warnings.push(`Link candidates (SystemOne verified): ${linkDesc}`);
        }
      } catch {
        // Fall back to lexical suggestLinks on error
      }
    }

    if (!decisionResult) {
      try {
        const suggestions = await suggestLinks(store, slug, data, content);
        if (suggestions.length > 0) {
          warnings.push(
            `Link candidates (only add [[X]] if you can state the relationship): ${suggestions.map((s) => `[[${s}]]`).join(" ")}`,
          );
        }
      } catch {
        // Advisory scan failed; the write itself succeeded. Do not fail the command.
      }
    }
  }

  return { success: true, warnings, decision: decisionResult };
}
