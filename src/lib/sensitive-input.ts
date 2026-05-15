export type SensitiveInputContext = "query" | "content";

export interface SensitiveInputResult {
  ok: boolean;
  text: string;
  warnings: string[];
  error?: string;
}

const SECRET_REJECT_MESSAGE =
  "Sensitive input rejected: remove actual secrets, credentials, or token values before using memex.";
const TOKENIZED_URL_WARNING =
  "Tokenized URL credentials were redacted before saving.";
const SECRET_LOCATOR_WARNING =
  "Query mentions a local credential path; prefer abstract search terms.";

const TOKENIZED_URL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+(?::[^\s/@]+)?@)([^\s<>'")]+)/gi;
const FLOMO_WEBHOOK_RE = /https:\/\/flomoapp\.com\/iwh\/([^\s<>'")]+)/gi;
const PEM_PRIVATE_KEY_BLOCK_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_RE = /\bAuthorization\s*:\s*Bearer\s+([^\s<>'")]{30,})/gi;
const ENV_ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Z0-9_]*(?:API|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|AUTH|KEY)[A-Z0-9_]*)\s*=\s*([^\n#]+)/gim;
const SECRET_LOCATOR_RE = /(^|[\s"'`(])(?:~\/\.(?:claude|aws|config|ssh|netrc|npmrc|docker|kube)(?:\/[^\s"'`)]+)?|\.env(?:\.[A-Za-z0-9_-]+)?)(?=$|[\s"'`)])/i;

const KNOWN_SECRET_RES = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  JWT_RE,
];

export function prepareMemexInput(text: string, context: SensitiveInputContext): SensitiveInputResult {
  const warnings: string[] = [];

  if (context === "query" && TOKENIZED_URL_RE.test(text)) {
    resetRegexes();
    return reject();
  }
  resetRegexes();

  let prepared = text;
  if (context === "content") {
    const masked = maskTokenizedUrls(prepared);
    if (masked !== prepared) {
      prepared = masked;
      warnings.push(TOKENIZED_URL_WARNING);
    }
  }

  if (hasRejectSecret(prepared)) return reject();

  if (context === "query" && SECRET_LOCATOR_RE.test(prepared)) {
    warnings.push(SECRET_LOCATOR_WARNING);
  }

  return { ok: true, text: prepared, warnings };
}

export function formatWarnings(warnings: string[]): string {
  return warnings.map((w) => `Warning: ${w}`).join("\n");
}

export function redactSensitiveText(text: string): string {
  let redacted = maskTokenizedUrls(text);
  redacted = maskFlomoWebhookUrls(redacted);
  redacted = redacted.replace(PEM_PRIVATE_KEY_BLOCK_RE, "<PRIVATE_KEY_REDACTED>");
  redacted = redacted.replace(BEARER_RE, "Authorization: Bearer <redacted>");
  for (const re of KNOWN_SECRET_RES) {
    redacted = redacted.replace(re, "<redacted>");
  }
  resetRegexes();
  return redacted;
}

export function maskSecretUrl(url: string): string {
  return redactSensitiveText(url);
}

export function maskFlomoWebhookUrl(url: string): string {
  return maskFlomoWebhookUrls(url);
}

function reject(): SensitiveInputResult {
  return { ok: false, text: "", warnings: [], error: SECRET_REJECT_MESSAGE };
}

function hasRejectSecret(text: string): boolean {
  if (PEM_PRIVATE_KEY_BLOCK_RE.test(text)) return true;
  resetRegexes();
  if (hasKnownSecret(text)) return true;
  if (hasBearerSecret(text)) return true;
  return hasEnvSecretAssignment(text);
}

function hasKnownSecret(text: string): boolean {
  for (const re of KNOWN_SECRET_RES) {
    if (re.test(text)) {
      resetRegexes();
      return true;
    }
  }
  resetRegexes();
  return false;
}

function hasBearerSecret(text: string): boolean {
  for (const match of text.matchAll(BEARER_RE)) {
    const value = match[1] ?? "";
    if (JWT_RE.test(value) || looksHighEntropySecret(value)) {
      resetRegexes();
      return true;
    }
  }
  resetRegexes();
  return false;
}

function hasEnvSecretAssignment(text: string): boolean {
  for (const match of text.matchAll(ENV_ASSIGNMENT_RE)) {
    const rawValue = stripEnvValue(match[2] ?? "");
    if (hasKnownSecret(rawValue) || hasBearerSecret(rawValue) || looksHighEntropySecret(rawValue)) {
      return true;
    }
  }
  resetRegexes();
  return false;
}

function stripEnvValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").trim();
}

function looksHighEntropySecret(value: string): boolean {
  const normalized = value.replace(/^Bearer\s+/i, "").trim();
  if (normalized.length < 24) return false;
  if (/^(?:x+|\*+|example|placeholder|your[-_]?token|token|secret)$/i.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized) || !/\d/.test(normalized)) return false;
  return shannonEntropy(normalized) >= 3.4;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function maskTokenizedUrls(text: string): string {
  return text.replace(TOKENIZED_URL_RE, (_match, scheme: string, userinfo: string, rest: string) => {
    const maskedUserinfo = userinfo.includes(":")
      ? `${userinfo.split(":")[0]}:<redacted>@`
      : "<redacted>@";
    return `${scheme}${maskedUserinfo}${rest}`;
  });
}

function maskFlomoWebhookUrls(text: string): string {
  return text.replace(FLOMO_WEBHOOK_RE, () => {
    return `https://flomoapp.com/iwh/<redacted>/`;
  });
}

function resetRegexes(): void {
  TOKENIZED_URL_RE.lastIndex = 0;
  FLOMO_WEBHOOK_RE.lastIndex = 0;
  PEM_PRIVATE_KEY_BLOCK_RE.lastIndex = 0;
  JWT_RE.lastIndex = 0;
  BEARER_RE.lastIndex = 0;
  ENV_ASSIGNMENT_RE.lastIndex = 0;
  for (const re of KNOWN_SECRET_RES) re.lastIndex = 0;
}
