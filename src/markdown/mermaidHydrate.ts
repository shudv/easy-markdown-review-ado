// Browser-side Mermaid hydration.
//
// `renderMarkdown` emits `<div class="emr-mermaid" data-mermaid-src="…">`
// placeholders; this module renders them into SVG via the `mermaid` library.
// `mermaid` is dynamic-imported (and guarded by a single shared promise) so
// its ~1 MB bundle is paid for only by articles that contain a diagram.

import { isDarkTheme } from "../theme/theme.helpers";
import { events, track, trackUserFacingError } from "../telemetry";
import type { DiagramRenderOutcome } from "../telemetry/events";
import { withChunkRetry } from "./chunkRetry";
import { repairSequenceSemicolons } from "./mermaidRepair";

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    src: string,
  ) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
};

// Config shared by every render pass. The `theme` is chosen per pass to match
// the reader's mode (see `currentMermaidTheme`), so diagrams recolour when the
// host flips light↔dark instead of staying pale-lavender on a dark canvas.
const BASE_CONFIG = {
  startOnLoad: false,
  // `strict` disables raw HTML and interactive click handlers inside diagrams;
  // our corpus doesn't need them.
  securityLevel: "strict",
  // Draw diagram text at the reader's prose size (Mermaid defaults to 16px,
  // which inflates every node) so a diagram sits at a comfortable default size
  // rather than towering over the body copy.
  fontSize: 14,
} as const;

const DEFAULT_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

let mermaidPromise: Promise<MermaidApi> | null = null;

function importWithChunkRetry(): Promise<typeof import("mermaid")> {
  return withChunkRetry(
    () => import(/* webpackChunkName: "mermaid" */ "mermaid"),
  );
}

function getMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = (async () => {
    const mod = await importWithChunkRetry();
    /* v8 ignore start -- ESM/CJS interop fallback; the bundler always provides `default` */
    const api: MermaidApi =
      (mod as { default: MermaidApi }).default ??
      (mod as unknown as MermaidApi);
    /* v8 ignore stop */
    return api;
  })().catch((error: unknown) => {
    // Drop the rejected promise so a later pass (a theme redraw, a re-render)
    // can retry instead of being stuck with the first chunk-load failure.
    mermaidPromise = null;
    throw error;
  });
  return mermaidPromise;
}

// Mermaid's built-in `dark` theme (dark node fills, light text, visible edges)
// reads far better on the reader's dark canvas than the light `default` theme
// (pale-lavender nodes). The reader writes its mode as `data-emr-theme` on
// <html>; mirror it (both high-contrast palettes count as dark).
function currentMermaidTheme(): "dark" | "default" {
  const theme = document.documentElement.getAttribute("data-emr-theme");
  return isDarkTheme(theme ?? "") ? "dark" : "default";
}

// Counter for unique render ids — mermaid requires a unique DOM id per
// diagram during render.
let renderSeq = 0;

// Mermaid lazy-loads a code chunk per diagram type inside `render()`, on top of
// the library chunk itself; both go through `withChunkRetry`.
function renderWithChunkRetry(
  api: MermaidApi,
  src: string,
): ReturnType<MermaidApi["render"]> {
  // A fresh id per attempt: mermaid needs a unique DOM id for each render.
  return withChunkRetry(() => api.render(`emr-mermaid-${++renderSeq}`, src));
}

// One report per failure per page load. The same broken diagram is re-rendered
// on every theme/font change and every revisit of its file, which used to send
// the identical error again each time (65 events from 9 sessions).
const reportedFailures = new Set<string>();

function reportOnce(key: string, operation: string, error: unknown): void {
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  trackUserFacingError({
    error,
    source: "Mermaid.hydrate",
    operation,
    impact: "degraded",
  });
}

/**
 * True for Mermaid's parser rejecting the author's source ("Parse error on
 * line N", "Lexical error …", an unknown diagram type). That's content health —
 * the diagram is wrong everywhere it's rendered — not an extension failure.
 */
export function isDiagramSyntaxError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return (
    name === "UnknownDiagramError" ||
    (typeof message === "string" &&
      /^(?:Parse error|Lexical error)\b|No diagram type detected/.test(message))
  );
}

/** Note a diagram that didn't parse as written, once per diagram per page load. */
function noteRenderIssueOnce(src: string, outcome: DiagramRenderOutcome): void {
  const key = `issue:${outcome}:${src}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  track(events.diagramRenderIssue({ outcome }));
}

/** Swap a placeholder's fallback for the rendered SVG, sized by the reader. */
function paint(
  el: HTMLElement,
  svg: string,
  theme: string,
  fontFamily: string,
): void {
  // A theme/font redraw can recover from an earlier render failure. Clear its
  // marker before replacing the fallback so error styling and downstream
  // guards (for example the source button) no longer apply.
  el.removeAttribute("data-mermaid-error");
  // Record the baked-in preferences before swapping innerHTML so a re-entrant
  // observer that fires during the swap doesn't double-render.
  el.setAttribute("data-hydrated", "true");
  el.setAttribute("data-mermaid-theme", theme);
  el.setAttribute("data-mermaid-font", fontFamily);
  el.innerHTML = svg;
  // Let the reader's text-size control scale the whole diagram. Capture the
  // diagram's natural width (the viewBox's 3rd value) into a custom prop the
  // stylesheet multiplies by `--emr-reader-scale`, and strip Mermaid's own
  // inline width caps so that rule governs the size. The viewBox scales nodes
  // AND their text uniformly, so both track the reading size.
  const svgEl = el.querySelector<SVGSVGElement>("svg")!;
  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    el.style.setProperty(
      "--emr-diagram-natural-w",
      `${viewBox.split(" ")[2]}px`,
    );
    svgEl.style.removeProperty("max-width");
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
  }
}

/**
 * Hydrate every `.emr-mermaid[data-mermaid-src]` placeholder under `root`
 * into a rendered SVG. Idempotent (skips `data-hydrated="true"`). The
 * existing `<pre>` fallback stays visible until replaced, so a slow first
 * `mermaid` import doesn't leave a blank gap.
 */
export async function hydrateMermaid(
  root: HTMLElement,
  fontFamily = DEFAULT_FONT_FAMILY,
): Promise<void> {
  const theme = currentMermaidTheme();
  // Mermaid SVGs bake both colours and fonts in at render time, so redraw when
  // either reader preference no longer matches the rendered diagram.
  const placeholders = Array.from(
    root.querySelectorAll<HTMLElement>(".emr-mermaid[data-mermaid-src]"),
  ).filter(
    (el) =>
      el.getAttribute("data-hydrated") !== "true" ||
      el.getAttribute("data-mermaid-theme") !== theme ||
      el.getAttribute("data-mermaid-font") !== fontFamily,
  );
  if (placeholders.length === 0) return;

  let api: MermaidApi;
  try {
    api = await getMermaid();
  } catch (err) {
    // Failed to load mermaid — leave fallbacks in place but flag them.
    for (const el of placeholders) {
      el.setAttribute("data-mermaid-error", "load-failed");
    }

    console.warn("[mermaid] failed to load library:", err);
    reportOnce("library-load", "diagram-library-load", err);
    return;
  }

  // Apply the current theme before this pass (cheap — just updates mermaid's
  // global config), so every diagram below renders in the reader's mode.
  api.initialize({ ...BASE_CONFIG, theme, fontFamily });

  await Promise.all(
    placeholders.map(async (el) => {
      const enc = el.getAttribute("data-mermaid-src");
      if (!enc) return;
      let src: string;
      try {
        src = decodeURIComponent(enc);
      } catch {
        return;
      }
      try {
        const { svg } = await renderWithChunkRetry(api, src);
        paint(el, svg, theme, fontFamily);
      } catch (err) {
        let error = err;
        // `;` in sequence-diagram text reads as a statement break to Mermaid
        // (the most common diagram failure in production). Retry once with
        // those escaped — only after a failure, so a diagram that renders as
        // written is never rewritten.
        const repaired = isDiagramSyntaxError(err)
          ? repairSequenceSemicolons(src)
          : null;
        if (repaired) {
          try {
            const { svg } = await renderWithChunkRetry(api, repaired);
            paint(el, svg, theme, fontFamily);
            noteRenderIssueOnce(src, "repaired");
            return;
          } catch (repairErr) {
            // Still a syntax error: keep the author's original one. Anything
            // else (a chunk load, a runtime fault) is the real failure.
            if (!isDiagramSyntaxError(repairErr)) error = repairErr;
          }
        }
        el.setAttribute("data-hydrated", "true");
        el.setAttribute("data-mermaid-theme", theme);
        el.setAttribute("data-mermaid-font", fontFamily);
        el.setAttribute("data-mermaid-error", "render-failed");
        // Keep the fallback `<pre>` so the user can still read the source.

        console.warn("[mermaid] render failed:", error);
        if (isDiagramSyntaxError(error))
          noteRenderIssueOnce(src, "syntax-error");
        else reportOnce(`render:${src}`, "diagram-render", error);
      }
    }),
  );
}
