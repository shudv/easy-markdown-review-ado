// Locating, revealing, and holding scroll on an in-document anchor target
// (a heading slug from an `#anchor` link or an `?anchor=` deep link).
//
// Pure DOM helpers (no React) so the lookup rules are unit-testable in jsdom;
// PrShell owns when they run.

import { slugifyHeading } from "../markdown/render";
import { wrapRangeTextNodes } from "../comments/highlight";
import { persistSectionState } from "./components/navStorage";
import { isContentText } from "./textFragment";

/**
 * Subtrees that render *reference* copies of Markdown (removed blocks, the
 * "Before" panels, metadata diffs). Their headings carry ids minted by the
 * same renderer, so an id lookup must skip them or a link could land on a
 * hidden removed heading instead of the live one.
 */
const REFERENCE_CONTENT_SELECTOR = [
  ".emr-diff-deleted-marker",
  ".emr-diff-before-panel",
  ".emr-diff-metadata-panel",
].join(", ");

/** Class applied briefly to a revealed target so the eye finds it. */
export const ANCHOR_TARGET_CLASS = "emr-anchor-target";

function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function findLiveId(root: ParentNode, id: string): HTMLElement | null {
  // Compare `id` directly instead of building an `[id="…"]` selector: the value
  // comes from a user-controlled URL and needs no escaping this way.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[id]"))) {
    if (el.id === id && !el.closest(REFERENCE_CONTENT_SELECTOR)) return el;
  }
  return null;
}

/**
 * Resolve an anchor to the live element it targets inside `root`. Tries the
 * literal id first (our own slugs, footnote ids, raw HTML ids), then the
 * percent-decoded form, then the anchor re-slugged with our heading slugger —
 * which maps ADO/GitHub-style slugs (`classifiers-&-hashing`,
 * `classifiers--hashing`) onto ours (`classifiers-hashing`). Returns `null`
 * when nothing matches (e.g. the heading was renamed since the link was made).
 */
export function findAnchorTarget(
  root: ParentNode,
  anchor: string,
): HTMLElement | null {
  const raw = anchor.replace(/^#+/, "").trim();
  if (!raw) return null;
  const decoded = decodeAnchor(raw);
  const candidates = [raw, decoded];
  // Only reslug anchors carrying text our slugger keeps (ASCII letters and
  // digits): anything else — punctuation, CJK, Cyrillic — slugs to the generic
  // "section" fallback and would match an unrelated heading.
  if (/[A-Za-z0-9]/.test(decoded)) candidates.push(slugifyHeading(decoded));
  for (const id of new Set(candidates)) {
    const hit = findLiveId(root, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Expand every collapsed section that hides `target` — its ancestors and the
 * section it heads (a deep link should show the content, not a folded stub).
 * Keeps each section's chevron button in sync and persists the open state, as
 * a manual expand does. Notifies the article wrap so balloons + the nav
 * re-measure. Returns whether anything changed.
 */
export function revealAnchorTarget(
  target: HTMLElement,
  storageKey: string,
): boolean {
  let changed = false;
  let section = target.closest<HTMLElement>(".emr-section");
  while (section) {
    if (section.getAttribute("data-collapsed") === "true") {
      section.removeAttribute("data-collapsed");
      const toggle = section.querySelector<HTMLElement>(
        ":scope > :is(h1, h2, h3, h4, h5, h6) > .emr-section-toggle",
      );
      if (toggle) {
        toggle.setAttribute("aria-label", "Collapse section");
        toggle.setAttribute("aria-expanded", "true");
        toggle.title = "Collapse section";
      }
      const sid = section.dataset.sectionId;
      if (sid) persistSectionState(storageKey, sid, false);
      changed = true;
    }
    section =
      section.parentElement?.closest<HTMLElement>(".emr-section") ?? null;
  }
  if (changed) {
    target
      .closest(".emr-article-wrap")
      ?.dispatchEvent(
        new CustomEvent("emr-sections-changed", { bubbles: false }),
      );
  }
  return changed;
}

/**
 * How long the landing cue lasts. Matches the comment highlight's landing
 * animation (`emr-anchor-land`), which the heading cue reuses.
 */
export const ANCHOR_TARGET_CUE_MS = 2500;

/**
 * Children of a heading that are controls, not its text: the collapse
 * chevron, the link button, and the diff "Before" disclosure. The cue never
 * wraps them (the same set the diff line wash leaves outside its wrapper).
 */
const CUE_EXCLUDED_SELECTOR = [
  ".emr-section-toggle",
  ".emr-heading-link",
  ".emr-diff-before-control",
  ".emr-diff-before-panel",
].join(", ");

/** Marks a cue span this module inserted (and must unwrap again). */
const CUE_WRAPPER_ATTR = "data-emr-anchor-cue";

/**
 * Put the cue class on an inline span around the target's text, so the wash
 * hugs the words — like a comment highlight's landing cue — instead of
 * filling the heading's full block width. A target with no text of its own
 * (e.g. an empty `<a id>`) carries the class itself.
 */
function applyCue(target: HTMLElement, delayMs: number): HTMLElement {
  const nodes = Array.from(target.childNodes).filter(
    (node) => !(node instanceof Element && node.matches(CUE_EXCLUDED_SELECTOR)),
  );
  let cue = target;
  /* v8 ignore next -- element/text/comment children always have string textContent; `?? ""` only satisfies the DOM typing */
  if (nodes.some((node) => (node.textContent ?? "").trim().length > 0)) {
    cue = target.ownerDocument.createElement("span");
    cue.setAttribute(CUE_WRAPPER_ATTR, "");
    target.insertBefore(cue, nodes[0]!);
    cue.append(...nodes);
  }
  if (delayMs > 0) cue.style.animationDelay = `-${delayMs}ms`;
  cue.classList.add(ANCHOR_TARGET_CLASS);
  return cue;
}

/** Undo {@link applyCue}: drop the class, and unwrap an inserted span. */
function clearCue(cue: HTMLElement): void {
  cue.classList.remove(ANCHOR_TARGET_CLASS);
  cue.style.removeProperty("animation-delay");
  if (cue.hasAttribute(CUE_WRAPPER_ATTR)) cue.replaceWith(...cue.childNodes);
}

/**
 * Play the "you landed here" cue on the anchor target, and keep it playing for
 * its full duration even if the article is re-wrapped meanwhile. Threads,
 * diffs, and images land just after a deep-linked document renders; each
 * re-wrap rebuilds the article's DOM, which would otherwise drop the cue a few
 * frames in. On each rebuild the fresh target gets the cue back with a
 * negative `animation-delay`, so the fade continues where it was rather than
 * restarting. Returns a cancel function (stops the cue immediately).
 */
export function flashAnchorTarget(
  article: HTMLElement,
  resolveTarget: () => HTMLElement | null,
): () => void {
  const startedAt = performance.now();
  let target = resolveTarget();
  let cue = target ? applyCue(target, 0) : null;
  const observer = new MutationObserver(() => {
    const next = resolveTarget();
    if (!next || next === target) return;
    target = next;
    cue = applyCue(next, Math.round(performance.now() - startedAt));
  });
  observer.observe(article, { childList: true, subtree: true });
  let done = false;
  // A timer, not `animationend`, so the cue always clears on schedule.
  const timer = window.setTimeout(cancel, ANCHOR_TARGET_CUE_MS);
  function cancel(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    if (cue) clearCue(cue);
  }
  return cancel;
}

/** Marks the inline spans {@link flashTextTarget} wraps around linked text. */
const TEXT_CUE_ATTR = "data-emr-text-cue";

/** The first live landing-cue span of a text link inside `article`, if any. */
export function currentTextCue(article: HTMLElement): HTMLElement | null {
  return article.querySelector<HTMLElement>(`[${TEXT_CUE_ATTR}]`);
}

/**
 * Play the heading's "you landed here" cue on a span of text (a `?text=` deep
 * link): the text is wrapped in inline cue spans, one per text node, so the
 * wash hugs the words line by line. Like {@link flashAnchorTarget} it survives
 * article re-wraps — when a rebuild drops the spans, `resolveRange()` is
 * re-run and the cue resumes where it was. Returns a cancel function that
 * stops the cue and unwraps the spans.
 */
export function flashTextTarget(
  article: HTMLElement,
  resolveRange: () => Range | null,
): () => void {
  const startedAt = performance.now();
  let cues: HTMLElement[] = [];
  const apply = (delayMs: number): void => {
    const range = resolveRange();
    cues = range
      ? wrapRangeTextNodes(
          range,
          () => {
            const span = article.ownerDocument.createElement("span");
            span.setAttribute(TEXT_CUE_ATTR, "");
            span.className = ANCHOR_TARGET_CLASS;
            if (delayMs > 0) span.style.animationDelay = `-${delayMs}ms`;
            return span;
          },
          isContentText,
        )
      : [];
  };
  apply(0);
  const observer = new MutationObserver(() => {
    // Our own wrap (or unrelated churn) leaves the spans in place.
    if (cues.length > 0 && cues.every((cue) => article.contains(cue))) return;
    apply(Math.round(performance.now() - startedAt));
  });
  observer.observe(article, { childList: true, subtree: true });
  let done = false;
  const timer = window.setTimeout(cancel, ANCHOR_TARGET_CUE_MS);
  function cancel(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    for (const cue of cues) cue.replaceWith(...cue.childNodes);
    cues = [];
  }
  return cancel;
}
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

/**
 * Keep `resolveTarget()` scrolled to the top of the viewport while the
 * document settles. Markdown paints first; diff decorations, comment
 * highlights, Mermaid, math, and images land afterwards and push content
 * down, which would leave a deep-linked heading off-screen. Re-aligns (without
 * animation) on every size change of `observed` until the reader scrolls,
 * clicks, or types, or `maxMs` elapses. `resolveTarget` is re-queried each
 * time because a re-wrap replaces the article's DOM. Returns a cancel function.
 * A no-op where `ResizeObserver` is unavailable.
 */
export function holdScrollOnTarget(
  observed: Element,
  resolveTarget: () => HTMLElement | null,
  maxMs = 5000,
  block: ScrollLogicalPosition = "start",
): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const doc = observed.ownerDocument;
  let done = false;
  // ResizeObserver reports once on `observe()` — that's the current layout,
  // which the caller just scrolled to; only later changes need re-aligning.
  let primed = false;
  const observer = new ResizeObserver(() => {
    if (!primed) {
      primed = true;
      return;
    }
    if (done) return;
    resolveTarget()?.scrollIntoView({ behavior: "auto", block });
  });
  const timer = window.setTimeout(cancel, maxMs);
  function cancel(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS) {
      doc.removeEventListener(type, cancel, true);
    }
  }
  observer.observe(observed);
  for (const type of USER_SCROLL_EVENTS) {
    doc.addEventListener(type, cancel, { capture: true, passive: true });
  }
  return cancel;
}
