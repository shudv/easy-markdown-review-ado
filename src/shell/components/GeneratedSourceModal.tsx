// Shared Source callout for rendered Mermaid diagrams and KaTeX equations.
// Before selects the historical version; Changes independently annotates the
// current source and is hidden while Before is active.

import * as React from "react";

import { hydrateMath } from "../../markdown/mathHydrate";
import { hydrateMermaid } from "../../markdown/mermaidHydrate";
import { diffCharacters, diffWords } from "../../markdown/wordDiff";
import { WORD_ADDED_CLASS, removedRunClass } from "../../markdown/wordDiffDom";
import { events, track } from "../../telemetry";

interface GeneratedSourceModalProps {
  /** Generated content kind. Defaults to Mermaid for existing callers. */
  kind?: "mermaid" | "math";
  /** Diagram/equation source; when non-null the modal is open. */
  source: string | null;
  /**
   * The pre-PR generated source. When set, Changes annotates current source and
   * Before switches both source and preview to the stale version.
   */
  originalSource?: string | null;
  onClose: () => void;
}

export function GeneratedSourceModal(
  props: GeneratedSourceModalProps,
): React.ReactElement | null {
  const { kind = "mermaid", source, originalSource, onClose } = props;
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [beforeShown, setBeforeShown] = React.useState(false);
  const [changesShown, setChangesShown] = React.useState(true);
  const hasDiff =
    source !== null && originalSource != null && originalSource !== source;
  const selectedSource =
    beforeShown && originalSource != null ? originalSource : source;

  // Close on Escape.
  React.useEffect(() => {
    if (source === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [source, onClose]);

  // Render the selected version in the preview pane.
  React.useEffect(() => {
    const el = previewRef.current;
    if (!el || selectedSource === null) return;
    const encoded = encodeURIComponent(selectedSource);
    if (kind === "math") {
      el.innerHTML =
        `<div class="emr-math emr-math--display" ` +
        `data-math-src="${encoded}" data-math-display="true">` +
        `<pre class="emr-math-fallback"><code></code></pre></div>`;
      el.querySelector("code")!.textContent = selectedSource;
      void hydrateMath(el);
    } else {
      el.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${encoded}"></div>`;
      void hydrateMermaid(el);
    }
  }, [kind, selectedSource]);

  React.useEffect(() => {
    setCopied(false);
    setBeforeShown(false);
    setChangesShown(hasDiff);
  }, [hasDiff, kind, source]);

  if (source === null) return null;

  // When the diagram changed in the PR, build a word-level diff of the
  // definition so reviewers see exactly what moved. `null` when unchanged.
  const diffNodes = hasDiff
    ? (kind === "math" ? diffCharacters : diffWords)(
        originalSource,
        source,
      ).map((op, i) => {
        if (op.kind === "added") {
          return (
            <ins key={i} className={WORD_ADDED_CLASS}>
              {op.value}
            </ins>
          );
        }
        if (op.kind === "removed") {
          return (
            <del key={i} className={removedRunClass(op.value)}>
              {op.value}
            </del>
          );
        }
        return <span key={i}>{op.value}</span>;
      })
    : null;

  const copy = () => {
    track(
      kind === "math"
        ? events.mathSourceCopied()
        : events.mermaidSourceCopied(),
    );
    void navigator.clipboard?.writeText(selectedSource!).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard blocked — ignore */
      },
    );
  };

  return (
    <div
      className="emr-generated-source-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        kind === "math" ? "Equation source" : "Mermaid diagram source"
      }
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="emr-generated-source-modal">
        <div className="emr-generated-source-header">
          <div className="emr-generated-source-identity">
            <span className="emr-generated-source-kind" aria-hidden="true">
              {kind === "math" ? (
                "ƒx"
              ) : (
                <svg viewBox="0 0 24 24">
                  <rect x="9" y="3" width="6" height="5" rx="1" />
                  <rect x="3" y="16" width="6" height="5" rx="1" />
                  <rect x="15" y="16" width="6" height="5" rx="1" />
                  <path d="M12 8v3.5M6 16v-2.5h12V16" />
                </svg>
              )}
            </span>
            <span className="emr-generated-source-title">
              {kind === "math" ? "Equation source" : "Diagram source"}
            </span>
          </div>
          <div className="emr-generated-source-actions">
            {hasDiff ? (
              <div className="emr-generated-source-view-controls">
                {!beforeShown ? (
                  <button
                    type="button"
                    className="emr-generated-source-toggle emr-generated-source-changes is-toggle"
                    aria-pressed={changesShown}
                    aria-label={
                      changesShown
                        ? "Hide source changes"
                        : "Show source changes"
                    }
                    title={
                      changesShown
                        ? "Hide source changes"
                        : "Show source changes"
                    }
                    onClick={() => setChangesShown((shown) => !shown)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2.5v13" />
                      <path d="M5.5 9h13" />
                      <path d="M5.5 21h13" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="emr-generated-source-toggle emr-generated-source-before is-toggle"
                  aria-pressed={beforeShown}
                  title={
                    beforeShown
                      ? "Return to the current version"
                      : "Show the previous version"
                  }
                  onClick={() => setBeforeShown((shown) => !shown)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v6h6" />
                  </svg>
                  <span>Before</span>
                </button>
              </div>
            ) : null}
            {hasDiff ? (
              <span className="emr-generated-source-action-divider" />
            ) : null}
            <button
              type="button"
              className="emr-generated-source-command emr-generated-source-copy"
              onClick={copy}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="11" height="11" rx="1.5" />
                <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-10A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17H8" />
              </svg>
              <span>{copied ? "Copied" : "Copy source"}</span>
            </button>
            <button
              type="button"
              className="emr-generated-source-command emr-generated-source-close"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="emr-generated-source-body" data-kind={kind}>
          <pre className="emr-generated-source-code">
            {!beforeShown && changesShown && diffNodes ? (
              <code className="emr-generated-source-code-diff">
                {diffNodes}
              </code>
            ) : (
              <code>{selectedSource}</code>
            )}
          </pre>
          <div
            className="emr-generated-source-preview markdown-body"
            ref={previewRef}
          />
        </div>
      </div>
    </div>
  );
}
