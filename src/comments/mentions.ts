// Mention infrastructure shared by all three pickers (@user, #workitem, !pr).
// Mentions persist as markdown links using a `mention://<kind>/<id>` URL
// convention: it round-trips cleanly through remark/rehype and degrades to a
// plain link in tools that don't understand the scheme.

import type { CommentAuthor, MentionedIdentity } from "../types";
// ---------------------------------------------------------------------------
// Suggestion types (discriminated union by kind)
// ---------------------------------------------------------------------------

export type MentionKind = "user" | "workitem" | "pullrequest";

export interface UserSuggestion {
  kind: "user";
  id: string;
  displayName: string;
  initials: string;
  /** Optional secondary line; ADO surfaces email here. */
  secondary?: string;
  avatarUrl?: string;
}

export interface WorkItemSuggestion {
  kind: "workitem";
  id: string;
  /** WI type ("Bug", "Task", "User Story", "Epic", "Feature", …). */
  workItemType: string;
  title: string;
  /** Current workflow state ("Active", "Resolved", "In Progress", …). */
  state: string;
  /** Optional state color override (#rrggbb) returned by ADO. */
  stateColor?: string;
}

export interface PullRequestSuggestion {
  kind: "pullrequest";
  id: string;
  title: string;
  /** "active" | "completed" | "abandoned". */
  status: "active" | "completed" | "abandoned";
  /** Optional repo for disambiguation; ADO surfaces this in the picker. */
  repository?: string;
}

export type MentionSuggestion =
  | UserSuggestion
  | WorkItemSuggestion
  | PullRequestSuggestion;

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

/** Active mention trigger detected in the textarea. */
export interface ActiveTrigger {
  kind: MentionKind;
  /** Trigger character itself (`@` / `#` / `!`). */
  char: string;
  /** Caret-relative position of the trigger character in the source. */
  start: number;
  /** Caret-relative end (== current caret) of the in-progress mention. */
  end: number;
  /** Text after the trigger char up to the caret (the typeahead query). */
  query: string;
}

const TRIGGER_CHARS: Record<string, MentionKind> = {
  "@": "user",
  "#": "workitem",
  "!": "pullrequest",
};

/**
 * Scan backwards from `caret` for an unbroken run of mention-friendly chars
 * (letters, digits, `_`, `-`, `.`, space) terminated by a trigger char.
 * Returns null when the user isn't inside a mention token. The trigger must
 * be at start-of-text or preceded by whitespace so `foo@bar` and `pre#tag`
 * don't open the picker.
 */
export function detectActiveTrigger(
  text: string,
  caret: number,
): ActiveTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  // Cap look-back; longer mentions are pathological — close the picker instead.
  const MAX_LOOKBACK = 64;
  const start = Math.max(0, caret - MAX_LOOKBACK);
  for (let i = caret - 1; i >= start; i--) {
    const ch = text[i]!;
    if (TRIGGER_CHARS[ch]) {
      const prev = i === 0 ? "" : text[i - 1]!;
      if (i !== 0 && !/\s/.test(prev)) return null;
      const kind = TRIGGER_CHARS[ch]!;
      return {
        kind,
        char: ch,
        start: i,
        end: caret,
        query: text.slice(i + 1, caret),
      };
    }
    // Allow the in-progress query to contain a small set of safe chars.
    if (!/[\w.\- ]/.test(ch)) return null;
  }
  return null;
}

/**
 * Build the markdown for a finalized mention: a regular link whose URL uses
 * our `mention://` scheme. The trailing space leaves the caret outside the
 * mention after insertion.
 */
export function buildMentionMarkdown(suggestion: MentionSuggestion): string {
  switch (suggestion.kind) {
    case "user": {
      // Persist the ADO-native mention token `@<GUID>` so Azure DevOps actually
      // recognises it as a mention — rendering the person's name AND sending the
      // notification — in every native view (Overview, Files, email). Our own
      // renderer converts this token to a rich pill via `preprocessUserMentions`
      // + the identity store; ADO understands it directly. The trailing space
      // leaves the caret outside the mention after insertion.
      return `@<${suggestion.id}> `;
    }
    case "workitem": {
      // Embed the title in the label so historical comments stay legible
      // without re-fetching; the renderer ignores it when richer data exists.
      const label = `#${suggestion.id} ${suggestion.title}`;
      const params = new URLSearchParams({
        type: suggestion.workItemType,
        state: suggestion.state,
      });
      if (suggestion.stateColor)
        params.set("stateColor", suggestion.stateColor);
      return `[${escapeLabel(label)}](mention://workitem/${encodeURIComponent(
        suggestion.id,
      )}?${params.toString()}) `;
    }
    case "pullrequest": {
      const label = `!${suggestion.id} ${suggestion.title}`;
      const params = new URLSearchParams({ status: suggestion.status });
      if (suggestion.repository) params.set("repo", suggestion.repository);
      return `[${escapeLabel(label)}](mention://pullrequest/${encodeURIComponent(
        suggestion.id,
      )}?${params.toString()}) `;
    }
  }
}

/** Escape markdown-special chars in the label so they survive parsing. */
function escapeLabel(s: string): string {
  return s.replace(/([\[\]\\])/g, "\\$1");
}

/**
 * Give a freshly-picked mention a visible label that's unique among the labels
 * already inserted in this composer, by appending " 2", " 3", … on collision.
 *
 * Two DIFFERENT people can share a display name (e.g. two "Shubham Dwivedi").
 * The composer shows the readable name while typing and re-encodes it to
 * `@<GUID>` on submit (see `encodePickedMentions`) — a shared label would be
 * ambiguous, encoding both to whichever id was picked first. A unique label
 * keeps each occurrence mapped to the right id. The numeric suffix is transient:
 * the token is re-encoded and rendered as a pill, so the reader never sees "2".
 */
export function uniqueMentionLabel(
  base: string,
  taken: readonly string[],
): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Re-encode readable `@Display Name` tokens (shown in the composer while the
 * author types) back to the ADO-native `@<GUID>` form for persistence. Each
 * `pick` pairs the label the composer inserted with the identity's id.
 *
 * Longer labels are matched first so `@Sam Lee` wins over `@Sam`, and a match
 * only counts when `@` starts a word (not `email@Sam`) and the label ends at a
 * boundary the trigger scanner also treats as ending a mention — i.e. NOT a
 * word char, `.` or `-` (which `detectActiveTrigger` allows inside mention
 * text). So `@Sam` won't fire inside `@Sammy`, `@Sam_Lee`, `@Sam.Lee`, or
 * `@Sam-Lee`. Labels edited after picking simply don't match and pass through.
 */
export function encodePickedMentions(
  text: string,
  picks: ReadonlyArray<{ label: string; id: string }>,
): string {
  if (picks.length === 0) return text;
  const sorted = [...picks].sort((a, b) => b.label.length - a.label.length);
  let out = text;
  for (const { label, id } of sorted) {
    if (!label) continue;
    const token = `@${label}`;
    const replacement = `@<${id}>`;
    let result = "";
    let i = 0;
    for (;;) {
      const at = out.indexOf(token, i);
      if (at === -1) {
        result += out.slice(i);
        break;
      }
      const before = at === 0 ? "" : out[at - 1]!;
      const after = out[at + token.length];
      const leftOk = at === 0 || /\s/.test(before);
      // Boundary rules consistent with `detectActiveTrigger`, which allows
      // `[\w.\-]` inside mention text: don't encode when the token is followed
      // by a word char, `.` or `-` (so `@Sam` isn't encoded inside `@Sam_Lee`).
      const rightOk = after === undefined || !/[\w.\-]/.test(after);
      if (leftOk && rightOk) {
        result += out.slice(i, at) + replacement;
      } else {
        result += out.slice(i, at + token.length);
      }
      i = at + token.length;
    }
    out = result;
  }
  return out;
}

/**
 * Parse a `mention://...` URL back into its parts. Returns null if the URL
 * doesn't match our scheme.
 */
export interface ParsedMentionUrl {
  kind: MentionKind;
  id: string;
  params: Record<string, string>;
}

export function parseMentionUrl(url: string): ParsedMentionUrl | null {
  if (!url.startsWith("mention://")) return null;
  // mention://<kind>/<id>?key=value&...
  const after = url.slice("mention://".length);
  const slash = after.indexOf("/");
  if (slash < 0) return null;
  const kindStr = after.slice(0, slash);
  if (
    kindStr !== "user" &&
    kindStr !== "workitem" &&
    kindStr !== "pullrequest"
  ) {
    return null;
  }
  const rest = after.slice(slash + 1);
  const q = rest.indexOf("?");
  const idRaw = q < 0 ? rest : rest.slice(0, q);
  const id = decodeURIComponent(idRaw);
  const params: Record<string, string> = {};
  if (q >= 0) {
    const search = new URLSearchParams(rest.slice(q + 1));
    for (const [k, v] of search) params[k] = v;
  }
  return { kind: kindStr, id, params };
}

// ---------------------------------------------------------------------------
// Native ADO user-mention token: `@<GUID>`
// ---------------------------------------------------------------------------

/**
 * Matches ADO's native user-mention token `@<GUID>` (8-4-4-4-12 hex). Global +
 * case-insensitive. The GUID form is specific enough that it effectively never
 * collides with real prose or code, so a raw-source pass is safe and lets the
 * token survive the Markdown parser (a bare `<GUID>` starting with a hex letter
 * would otherwise be treated as raw HTML and dropped by our sanitizer).
 */
export const USER_MENTION_RE =
  /@<([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/**
 * Rewrite native `@<GUID>` user mentions in raw Markdown into our existing
 * `mention://user/<id>` link form BEFORE parsing, so they flow through the same
 * `rehypeMentions` pill pipeline as everything else. The visible label defaults
 * to the id; the identity store later swaps it for the display name. Run on
 * every comment body (ours and ADO-native) so both render identically.
 */
export function preprocessUserMentions(md: string): string {
  return md.replace(
    USER_MENTION_RE,
    (_m, id: string) => `[@${id}](mention://user/${encodeURIComponent(id)})`,
  );
}

/** Matches the `mention://user/<id>` link form our renderer/composer persist. */
const USER_MENTION_LINK_RE = /mention:\/\/user\/([^)\s"']+)/g;

/**
 * Normalize an ADO identity id to the canonical dashed GUID that ADO's native
 * `@<GUID>` mention token uses (and that comment authors already carry as
 * `author.id`).
 *
 * The identity picker returns `entityId` in the storage-key form
 * `vss.ds.v1.ims.user.<32-hex>` (no dashes), while comments/notifications key
 * off the dashed GUID `6b71186c-c2e6-6813-b4e0-ffcd511163f4`. Given any of:
 *   - a dashed GUID           -> returned lower-cased,
 *   - a bare 32-hex string    -> dashes inserted,
 *   - a string CONTAINING a 32-hex run (e.g. the `vss.ds…` entityId) -> the run
 *     is extracted + dashed,
 * returns the dashed GUID. Returns `undefined` when no GUID can be found (so
 * callers can fall back rather than emit a token ADO won't resolve).
 */
export function normalizeIdentityGuid(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const dashed =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(raw);
  if (dashed) return dashed[0].toLowerCase();
  const bare = /[0-9a-f]{32}/i.exec(raw);
  if (bare) {
    const h = bare[0].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
      16,
      20,
    )}-${h.slice(20)}`;
  }
  return undefined;
}

/**
 * Collect every referenced user-mention id from a raw Markdown body, covering
 * both the ADO-native `@<GUID>` token and the `mention://user/<id>` link form.
 * Ids are de-duplicated (case-insensitively) so callers can prefetch display
 * names for a whole set of comments in one pass. Link-form ids are URL-decoded.
 */
export function collectUserMentionIds(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string): void => {
    const id = raw.trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  };
  for (const m of body.matchAll(USER_MENTION_RE)) add(m[1]!);
  for (const m of body.matchAll(USER_MENTION_LINK_RE)) {
    try {
      add(decodeURIComponent(m[1]!));
    } catch {
      /* v8 ignore next -- malformed percent-encoding: fall back to raw id */
      add(m[1]!);
    }
  }
  return out;
}

/**
 * Resolve the picked identities behind a body's `@`-mentions using a `lookup`
 * (typically the IdentityStore, which the composer seeds at pick time). Returns
 * one {@link MentionedIdentity} per distinct mentioned user the lookup can name,
 * so callers can PERSIST those names (into a thread property we own) and re-seed
 * them on load — the only reliable name source in orgs where ADO's by-id
 * identity endpoint and `thread.identities` don't resolve a mentioned user
 * (e.g. cross-tenant AAD guests in a personal-MSA org). Ids are normalized to
 * the dashed GUID so they key the same as the rendered pills.
 */
export function collectMentionIdentities(
  body: string,
  lookup: (
    id: string,
  ) => { displayName: string; avatarUrl?: string } | undefined,
): MentionedIdentity[] {
  const out: MentionedIdentity[] = [];
  const seen = new Set<string>();
  for (const raw of collectUserMentionIds(body)) {
    const id = normalizeIdentityGuid(raw) ?? raw;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    const info = lookup(id);
    if (!info?.displayName) continue;
    seen.add(key);
    out.push({ id, displayName: info.displayName, avatarUrl: info.avatarUrl });
  }
  return out;
}

/**
 * Union several mention-identity lists, de-duplicated by normalized id (first
 * occurrence wins). Used to merge a thread's already-known mentions with the
 * ones a new reply adds before persisting the full set.
 */
export function mergeMentionIdentities(
  ...lists: ReadonlyArray<readonly MentionedIdentity[]>
): MentionedIdentity[] {
  const out: MentionedIdentity[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const m of list) {
      const key = (normalizeIdentityGuid(m.id) ?? m.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience: turn a CommentAuthor into a UserSuggestion. Used by the
// LocalOnly api when surfacing fixture users in the picker.
// ---------------------------------------------------------------------------

export function authorToUserSuggestion(a: CommentAuthor): UserSuggestion {
  return {
    kind: "user",
    id: a.id,
    displayName: a.displayName,
    initials: a.initials,
    avatarUrl: a.avatarUrl,
  };
}
