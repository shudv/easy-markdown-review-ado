// The "</> Source" affordance on generated blocks (Mermaid diagrams, math).

/** Generated block whose Source action was clicked (see `GeneratedSourceModal`). */
export interface GeneratedSourceView {
  kind: "mermaid" | "math";
  source: string;
  original: string | null;
}

/**
 * Both generated block kinds share one Source affordance and one callout, so
 * the per-kind selectors/labels live here rather than in duplicated branches.
 */
export const GENERATED_SOURCE_KINDS = [
  {
    kind: "mermaid",
    hostSelector: ".emr-mermaid",
    hydratedSelector: ".emr-mermaid[data-mermaid-src]",
    buttonClass: "emr-mermaid-source-btn",
    sourceAttribute: "data-mermaid-src",
    errorAttribute: "data-mermaid-error",
    buttonTitle: "View diagram source",
  },
  {
    kind: "math",
    hostSelector: ".emr-math",
    hydratedSelector: '.emr-math[data-math-src][data-hydrated="true"]',
    buttonClass: "emr-math-source-btn",
    sourceAttribute: "data-math-src",
    errorAttribute: "data-math-error",
    buttonTitle: "View equation source",
  },
] as const;

export const GENERATED_SOURCE_BUTTON_SELECTOR = GENERATED_SOURCE_KINDS.map(
  (spec) => `.${spec.buttonClass}`,
).join(", ");

export function decodeGeneratedSource(enc: string): string {
  try {
    return decodeURIComponent(enc);
  } catch {
    return enc;
  }
}

/**
 * Inject the "</> Source" affordance into every hydrated diagram/equation.
 * Runs after hydration so each block still carries its encoded source
 * attribute, which the callout reads back without extra state plumbing.
 */
export function addGeneratedSourceButtons(root: HTMLElement): void {
  for (const spec of GENERATED_SOURCE_KINDS) {
    root
      .querySelectorAll<HTMLElement>(spec.hydratedSelector)
      .forEach((block) => {
        if (block.querySelector(`:scope > .${spec.buttonClass}`)) return;
        if (block.getAttribute(spec.errorAttribute)) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = spec.buttonClass;
        button.title = spec.buttonTitle;
        button.textContent = "</> Source";
        block.appendChild(button);
      });
  }
}
