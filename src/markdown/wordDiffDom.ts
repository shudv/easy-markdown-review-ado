// Apply a word-level diff inline onto a rendered Markdown block.
//
// Given the ops from `diffWords(original, modified)` — where `modified` is the
// block's current rendered text — this wraps every ADDED word run in a green
// `<ins class="emr-word-added">` and splices each REMOVED run back in as a
// struck-through red `<del class="emr-word-removed">` at the point it used to
// occupy. Unchanged words keep their exact DOM (formatting spans, links, and
// comment-anchor `<span class="emr-highlight">` all survive) because we only
// ever rewrite TEXT nodes, never element structure.
//
// Pure + idempotent-friendly: the caller clears prior markers first. jsdom-
// tested.

import type { WordDiffOp } from "./wordDiff";

/** Class on an inline "added word(s)" mark. */
export const WORD_ADDED_CLASS = "emr-word-added";
/** Class on an inline "removed word(s)" mark. */
export const WORD_REMOVED_CLASS = "emr-word-removed";
/**
 * Modifier on a removed-word mark whose text has no letters or digits — a lone
 * comma, period, dash, or a merged space. Such glyphs carry no ink at strike
 * height, so a `line-through` floats above them as a detached dash; the styles
 * drop the strike for this class and lean on the red tint instead.
 */
export const WORD_REMOVED_TIGHT_CLASS = "emr-word-removed--tight";

/**
 * Class list for a removed run: the base mark, plus the "tight" modifier when
 * the run has no strikeable ink (no letters or digits) so a strikethrough would
 * float above the glyph rather than cross it. Exported so the Mermaid
 * source-diff modal — which renders its own `<del>` marks outside `.emr-
 * rendered` — applies the exact same rule.
 */
export function removedRunClass(text: string): string {
  return /[\p{L}\p{N}]/u.test(text)
    ? WORD_REMOVED_CLASS
    : `${WORD_REMOVED_CLASS} ${WORD_REMOVED_TIGHT_CLASS}`;
}

interface AddedSegment {
  /** Inclusive start offset in the modified (flat) text. */
  start: number;
  /** Exclusive end offset in the modified text. */
  end: number;
}

interface Removal {
  /** Offset in the modified text where the removed run used to sit. */
  at: number;
  /** The removed text. */
  text: string;
}

interface FlatTextNode {
  node: Text;
  /** Flat offset where this node's text starts. */
  start: number;
  /** Flat offset where this node's text ends (exclusive). */
  end: number;
}

/**
 * Result of an inline word-diff application: how many marks were inserted.
 */
export interface InlineWordDiffResult {
  added: number;
  removed: number;
}

/** Collect the block's descendant text nodes with their flat offsets. */
function flattenTextNodes(block: HTMLElement): {
  nodes: FlatTextNode[];
  text: string;
} {
  const nodes: FlatTextNode[] = [];
  let acc = "";
  const walker = block.ownerDocument.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let n: Node | null = walker.nextNode();
  while (n) {
    const data = (n as Text).data;
    if (data.length > 0) {
      const start = acc.length;
      nodes.push({ node: n as Text, start, end: start + data.length });
      acc += data;
    }
    n = walker.nextNode();
  }
  return { nodes, text: acc };
}

/**
 * Split the diff ops into added segments + removals in modified-text
 * coordinates. `equal`/`added` advance the modified cursor; `removed` records
 * an insertion point without advancing (it isn't present in the modified text).
 */
function planEdits(ops: readonly WordDiffOp[]): {
  added: AddedSegment[];
  removals: Removal[];
} {
  const added: AddedSegment[] = [];
  const removals: Removal[] = [];
  let cursor = 0;
  for (const op of ops) {
    if (op.kind === "equal") {
      cursor += op.value.length;
    } else if (op.kind === "added") {
      added.push({ start: cursor, end: cursor + op.value.length });
      cursor += op.value.length;
    } else {
      removals.push({ at: cursor, text: op.value });
    }
  }
  return { added, removals };
}

function makeMark(
  doc: Document,
  tag: "ins" | "del",
  className: string,
  text: string,
): HTMLElement {
  const el = doc.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Rewrite a single text node into a fragment carrying its plain text plus any
 * added-word wraps and removed-word insertions that fall within it.
 */
function rewriteNode(
  entry: FlatTextNode,
  added: readonly AddedSegment[],
  removals: readonly Removal[],
): { fragment: DocumentFragment; addedCount: number; removedCount: number } {
  const doc = entry.node.ownerDocument;
  const { start: ns, end: ne } = entry;
  const data = entry.node.data;

  // Build ordered boundary events local to this node.
  interface Event {
    pos: number; // local offset (0..len)
    kind: "add-start" | "add-end" | "remove";
    /** Removed text (only meaningful for `remove` events; "" otherwise). */
    text: string;
  }
  const events: Event[] = [];
  for (const seg of added) {
    const s = Math.max(seg.start, ns);
    const e = Math.min(seg.end, ne);
    if (s < e) {
      events.push({ pos: s - ns, kind: "add-start", text: "" });
      events.push({ pos: e - ns, kind: "add-end", text: "" });
    }
  }
  for (const r of removals) {
    // Assign a removal to the node that contains its offset. A removal exactly
    // at this node's end belongs to the next node's start instead — except at
    // the very end of the block, handled by the caller.
    if (r.at >= ns && r.at < ne) {
      events.push({ pos: r.at - ns, kind: "remove", text: r.text });
    }
  }
  if (events.length === 0) {
    const fragment = doc.createDocumentFragment();
    fragment.appendChild(entry.node.cloneNode(true));
    return { fragment, addedCount: 0, removedCount: 0 };
  }

  // Stable sort: at the same position emit a removal (old) before an add-start
  // (new) so the reader sees "was → now"; add-end before add-start when
  // touching.
  const order = { "add-end": 0, remove: 1, "add-start": 2 };
  events.sort((a, b) => a.pos - b.pos || order[a.kind] - order[b.kind]);

  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  let inAdd = false;
  let addedCount = 0;
  let removedCount = 0;

  const emitPlain = (from: number, to: number, wrapped: boolean) => {
    if (to <= from) return;
    const text = data.slice(from, to);
    if (wrapped) {
      fragment.appendChild(makeMark(doc, "ins", WORD_ADDED_CLASS, text));
    } else {
      fragment.appendChild(doc.createTextNode(text));
    }
  };

  for (const ev of events) {
    if (ev.pos > cursor) {
      emitPlain(cursor, ev.pos, inAdd);
      cursor = ev.pos;
    }
    if (ev.kind === "remove") {
      fragment.appendChild(
        makeMark(doc, "del", removedRunClass(ev.text), ev.text),
      );
      removedCount++;
    } else if (ev.kind === "add-start") {
      inAdd = true;
    } else {
      // add-end: the run [previous cursor .. pos] already emitted as wrapped.
      inAdd = false;
      addedCount++;
    }
  }
  // Tail after the last event.
  emitPlain(cursor, data.length, inAdd);

  return { fragment, addedCount, removedCount };
}

/**
 * Apply the inline word diff described by `ops` onto `block`. Returns the
 * counts of marks inserted, or `null` when the ops don't reconstruct the
 * block's current text (a safety check — the caller should keep the plain
 * block wash in that case).
 */
export function applyInlineWordDiff(
  block: HTMLElement,
  ops: readonly WordDiffOp[],
): InlineWordDiffResult | null {
  const { nodes, text } = flattenTextNodes(block);
  // Sanity: equal + added must reconstruct the block's live text. If the
  // rendered text diverges from what we diffed, bail rather than corrupt it.
  const rebuilt = ops
    .filter((o) => o.kind !== "removed")
    .map((o) => o.value)
    .join("");
  if (rebuilt !== text) return null;

  const { added, removals } = planEdits(ops);
  if (added.length === 0 && removals.length === 0) {
    return { added: 0, removed: 0 };
  }

  const totalEnd = text.length;
  let addedCount = 0;
  let removedCount = 0;

  // Rewrite each text node (snapshot first — we mutate the tree as we go).
  for (const entry of nodes) {
    const {
      fragment,
      addedCount: a,
      removedCount: r,
    } = rewriteNode(entry, added, removals);
    addedCount += a;
    removedCount += r;
    entry.node.parentNode?.replaceChild(fragment, entry.node);
  }

  // A removal sitting at the very end of the block has no containing node;
  // append it after the last content.
  for (const r of removals) {
    if (r.at === totalEnd) {
      block.appendChild(
        makeMark(block.ownerDocument, "del", removedRunClass(r.text), r.text),
      );
      removedCount++;
    }
  }

  return { added: addedCount, removed: removedCount };
}
