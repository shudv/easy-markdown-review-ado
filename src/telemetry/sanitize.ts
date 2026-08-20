// Privacy guardrail.
//
// Defense in depth: the typed event builders in `events.ts` are *supposed* to
// pass only de-identified ids, counts, and enums. This module is the runtime
// backstop that guarantees it — so a future careless `repoName` or a raw email
// can never reach the wire. Every property bag passes through `sanitizeProperties`
// before a sink sees it.
//
// Strategy:
//   1. Reject keys whose name hints at human-readable content (name, path,
//      email, title, body, …).
//   2. Reject scalar values that *look* like PII (emails, paths, URLs, long
//      free text, whitespace-bearing strings).
//   3. Pass through ids/enums/booleans/numbers.

/** Substrings that, when present in a property key, indicate likely PII. */
const DENY_KEY_SUBSTRINGS = [
  "name",
  "path",
  "email",
  "mail",
  "title",
  "url",
  "uri",
  "href",
  "body",
  "text",
  "content",
  "markdown",
  "display",
  "author",
  "user",
  "message",
  "query",
  "term",
  "keyword",
  "file",
  "comment",
  "description",
  "summary",
  "token",
  "secret",
  "address",
  "phone",
];

/** Keys explicitly allowed even though a deny-substring matches (id-shaped). */
const ALLOW_KEYS = new Set<string>([
  // none today; reserved so we can permit e.g. an enum named "filetype" later
]);

/**
 * Substrings that must never appear in a *measurement* key. Measurements are
 * numeric metrics, so the broad property denylist (which trips on legitimate
 * count/length names like `bodyLength`, `commentCount`, `queryLength`) is wrong
 * here. This narrower list rejects identity-shaped numeric keys — e.g. a stray
 * `user.id` or `phoneNumber` — that could re-identify a person.
 */
const MEASUREMENT_DENY_SUBSTRINGS = [
  "user",
  "email",
  "mail",
  "phone",
  "address",
  "ssn",
  "secret",
  "token",
];

const MAX_VALUE_LENGTH = 64;
const EMAIL_RE = /@/;
const PATH_LIKE_RE = /[\\/]/;
const WHITESPACE_RE = /\s/;
// Hostname / domain shape (e.g. `example.com`) — caught even without a slash.
const DOMAIN_LIKE_RE = /[a-z0-9-]+\.[a-z]{2,}/i;
// Property keys must be simple identifiers (dotted/camel allowed).
const VALID_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._]*$/;

export interface SanitizeResult {
  clean: Record<string, string | number | boolean>;
  /** Keys that were dropped, for dev-time diagnostics. Never sent. */
  dropped: string[];
}

function keyLooksSafe(key: string): boolean {
  if (ALLOW_KEYS.has(key)) return true;
  if (!VALID_KEY_RE.test(key)) return false;
  const lower = key.toLowerCase();
  return !DENY_KEY_SUBSTRINGS.some((bad) => lower.includes(bad));
}

function valueLooksSafe(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return false;
    if (EMAIL_RE.test(value)) return false;
    if (PATH_LIKE_RE.test(value)) return false;
    if (WHITESPACE_RE.test(value)) return false;
    if (DOMAIN_LIKE_RE.test(value)) return false;
    return true;
  }
  return false;
}

/**
 * Filter a property bag down to provably-safe key/value pairs. Unsafe entries
 * are dropped silently (their keys are reported in `dropped` for dev logging).
 */
export function sanitizeProperties(
  props: Record<string, unknown> | undefined,
): SanitizeResult {
  const clean: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  if (!props) return { clean, dropped };

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (keyLooksSafe(key) && valueLooksSafe(value)) {
      clean[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { clean, dropped };
}

/**
 * Keep only finite numbers under identifier-shaped, non-identity keys. The
 * value being numeric rules out free-text PII; the key check additionally drops
 * identity-shaped metrics (e.g. a stray `user.id`) that a number could still
 * re-identify.
 */
export function sanitizeMeasurements(
  measurements: Record<string, number> | undefined,
): Record<string, number> {
  const clean: Record<string, number> = {};
  if (!measurements) return clean;
  for (const [key, value] of Object.entries(measurements)) {
    if (!VALID_KEY_RE.test(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const lower = key.toLowerCase();
    if (MEASUREMENT_DENY_SUBSTRINGS.some((bad) => lower.includes(bad)))
      continue;
    clean[key] = value;
  }
  return clean;
}

// Redaction patterns for free-text error fields. Order matters: e-mail and URL
// forms are collapsed before bare path matching so a `file://` URL or an
// address embedded in a path is not partially rewritten.
const EMAIL_GLOBAL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_GLOBAL_RE = /\b(?:https?|file):\/\/[^\s)]+/gi;
const WIN_PATH_RE = /[A-Za-z]:\\[^\s:*?"<>|]+/g;
const POSIX_PATH_RE = /(?:\/[\w.@-]+){2,}/g;

/**
 * Scrub free-text error fields (an exception `message` or `stack`) before they
 * leave the tenant: strip e-mail addresses, URLs, and filesystem paths — which
 * leak usernames and machine layout — then cap the length. Function/symbol
 * names in a stack are code, not PII, so they survive. Returns `undefined`
 * unchanged so callers can pass an absent stack straight through.
 */
export function redactText(
  input: string | undefined,
  maxLength = 1024,
): string | undefined {
  if (input === undefined) return undefined;
  let out = input
    .replace(EMAIL_GLOBAL_RE, "[email]")
    .replace(URL_GLOBAL_RE, "[url]")
    .replace(WIN_PATH_RE, "[path]")
    .replace(POSIX_PATH_RE, "[path]");
  if (out.length > maxLength) out = out.slice(0, maxLength) + "…";
  return out;
}

/**
 * Pseudonymise an identifier (e.g. a pull-request id) so the raw value never
 * leaves the tenant boundary. FNV-1a 32-bit — NOT cryptographic, but a stable,
 * synchronous, one-way-enough mapping adequate for de-identifying values in
 * aggregate analytics. Use only for low-sensitivity ids, never for secrets.
 */
export function hashId(value: string | number): string {
  const str = String(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}
