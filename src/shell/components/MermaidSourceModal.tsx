// MermaidSourceModal — "view source" for a rendered Mermaid diagram. Opened
// from the "</> Source" affordance ArticleView adds to each hydrated diagram;
// shows the definition alongside a fresh render of the same source.

import * as React from "react";

import { hydrateMermaid } from "../../markdown/mermaidHydrate";
import { diffWords } from "../../markdown/wordDiff";
import { WORD_ADDED_CLASS, removedRunClass } from "../../markdown/wordDiffDom";
import { events, track } from "../../telemetry";

interface MermaidSourceModalProps {
  /** Diagram source; when non-null the modal is open. */
  source: string | null;
  /**
   * The pre-PR diagram source when this diagram changed in the pull request.
   * When set (and different from `source`) the modal shows a word-level diff
   * of the definition alongside the rendered preview.
   */
  originalSource?: string | null;
  onClose: () => void;
}

export function MermaidSourceModal(
  props: MermaidSourceModalProps,
): React.ReactElement | null {
  const { source, originalSource, onClose } = props;
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = React.useState(false);

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

  // Render the diagram into the preview pane whenever the source changes.
  React.useEffect(() => {
    const el = previewRef.current;
    if (!el || source === null) return;
    el.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${encodeURIComponent(
      source,
    )}"></div>`;
    void hydrateMermaid(el);
  }, [source]);

  React.useEffect(() => {
    setCopied(false);
  }, [source]);

  if (source === null) return null;

  // When the diagram changed in the PR, build a word-level diff of the
  // definition so reviewers see exactly what moved. `null` when unchanged.
  const hasDiff = originalSource != null && originalSource !== source;
  const diffNodes = hasDiff
    ? diffWords(originalSource, source).map((op, i) => {
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
    track(events.mermaidSourceCopied());
    void navigator.clipboard?.writeText(source).then(
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
      className="emr-mermaid-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram source"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="emr-mermaid-modal">
        <div className="emr-mermaid-modal-header">
          <span className="emr-mermaid-modal-title">
            {hasDiff ? "Diagram source changes" : "Diagram source"}
          </span>
          <div className="emr-mermaid-modal-actions">
            <button type="button" className="emr-editor-btn" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="emr-editor-btn"
              onClick={onClose}
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>
        <div className="emr-mermaid-modal-body">
          <pre className="emr-mermaid-modal-source">
            {diffNodes ? (
              <code className="emr-mermaid-modal-source-diff">{diffNodes}</code>
            ) : (
              <code>{source}</code>
            )}
          </pre>
          <div
            className="emr-mermaid-modal-preview markdown-body"
            ref={previewRef}
          />
        </div>
      </div>
    </div>
  );
}
