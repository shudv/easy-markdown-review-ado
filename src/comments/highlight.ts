// Wrap a Range with a styled span so the user sees the comment anchor.
//
// `surroundContents` on a Range only works when the range starts/ends in the
// same text node and doesn't cross element boundaries. For mixed-content
// ranges (e.g. "**bold** plus regular") we walk the range and wrap each
// text-node fragment independently.
//
// Returns the list of wrapper spans created so the caller can compute the
// bounding box across them.

export interface HighlightOptions {
  className: string;
  /** Stable identifier the caller uses to look up these spans later. */
  threadId: string;
  /**
   * Per-thread highlight color override (CSS `background-color`). When omitted
   * we rely on the CSS rule attached to `className`.
   */
  background?: string;
}

export function wrapRangeWithHighlight(
  range: Range,
  opts: HighlightOptions,
): HTMLSpanElement[] {
  // Snapshot the text nodes covered by the range BEFORE we mutate, otherwise
  // our splits invalidate the iterator.
  const fragments = collectTextFragments(range);
  const spans: HTMLSpanElement[] = [];
  for (const frag of fragments) {
    const span = document.createElement("span");
    span.className = opts.className;
    span.dataset.threadId = opts.threadId;
    if (opts.background) span.style.backgroundColor = opts.background;
    // Wrap this fragment: split the text node so [start, end] is its own node,
    // then replace.
    let node = frag.node;
    if (frag.end < node.data.length) {
      node.splitText(frag.end);
    }
    if (frag.start > 0) {
      node = node.splitText(frag.start);
    }
    node.parentNode!.replaceChild(span, node);
    span.appendChild(node);
    spans.push(span);
  }
  return spans;
}

interface TextFragment {
  node: Text;
  start: number;
  end: number;
}

function collectTextFragments(range: Range): TextFragment[] {
  const out: TextFragment[] = [];
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      // Skip text nodes outside the range.
      const r = document.createRange();
      r.selectNodeContents(n);
      if (range.compareBoundaryPoints(Range.END_TO_START, r) >= 0) {
        return NodeFilter.FILTER_REJECT;
      }
      if (range.compareBoundaryPoints(Range.START_TO_END, r) <= 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  // For a TreeWalker rooted at the common ancestor, if the ancestor itself is
  // a Text node we need to handle it directly (walker starts past it). A range
  // whose common ancestor is a text node lies wholly within it, so both
  // boundaries are offsets into this very node.
  if (root.nodeType === Node.TEXT_NODE) {
    const tn = root as Text;
    if (
      range.endOffset > range.startOffset &&
      tn.data.slice(range.startOffset, range.endOffset).trim() !== ""
    ) {
      out.push({ node: tn, start: range.startOffset, end: range.endOffset });
    }
    return out;
  }
  let n: Node | null = walker.nextNode();
  while (n) {
    const tn = n as Text;
    const start = range.startContainer === tn ? range.startOffset : 0;
    const end = range.endContainer === tn ? range.endOffset : tn.data.length;
    // Skip whitespace-only fragments. These are the `\n` / indentation text
    // nodes that live BETWEEN block elements (e.g. between `<tr>`/`<td>` in a
    // table, or between paragraphs). Wrapping them produces stray yellow
    // slivers and — worse — injects a `<span>` as a direct child of `<tr>` /
    // `<table>`, which is invalid HTML the browser reflows, visibly breaking
    // table/code layout on large multi-block selections. Highlighting pure
    // whitespace conveys nothing, so we simply don't.
    if (end > start && tn.data.slice(start, end).trim() !== "") {
      out.push({ node: tn, start, end });
    }
    n = walker.nextNode();
  }
  return out;
}
