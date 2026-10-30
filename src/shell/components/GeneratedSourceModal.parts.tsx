// Presentational pieces of the GeneratedSourceModal header and code pane.

import * as React from "react";

import { diffCharacters, diffWords } from "../../markdown/wordDiff";
import { WORD_ADDED_CLASS, removedRunClass } from "../../markdown/wordDiffDom";

type GeneratedSourceKind = "mermaid" | "math";

/** Kind glyph + title at the left of the modal header. */
export function GeneratedSourceIdentity(props: {
  kind: GeneratedSourceKind;
}): React.ReactElement {
  const isMath = props.kind === "math";
  return (
    <div className="emr-generated-source-identity">
      <span className="emr-generated-source-kind" aria-hidden="true">
        {isMath ? (
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
        {isMath ? "Equation source" : "Diagram source"}
      </span>
    </div>
  );
}

/** Changes + Before toggles, shown only when the source changed in the PR. */
export function GeneratedSourceViewControls(props: {
  beforeShown: boolean;
  changesShown: boolean;
  onToggleBefore: () => void;
  onToggleChanges: () => void;
}): React.ReactElement {
  const { beforeShown, changesShown, onToggleBefore, onToggleChanges } = props;
  const changesLabel = changesShown
    ? "Hide source changes"
    : "Show source changes";
  return (
    <div className="emr-generated-source-view-controls">
      {!beforeShown ? (
        <button
          type="button"
          className="emr-generated-source-toggle emr-generated-source-changes is-toggle"
          aria-pressed={changesShown}
          aria-label={changesLabel}
          title={changesLabel}
          onClick={onToggleChanges}
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
        onClick={onToggleBefore}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v6h6" />
        </svg>
        <span>Before</span>
      </button>
    </div>
  );
}

/**
 * Word-level (character-level for math) diff of the definition, so reviewers
 * see exactly what moved in the PR.
 */
export function GeneratedSourceDiff(props: {
  kind: GeneratedSourceKind;
  original: string;
  current: string;
}): React.ReactElement {
  const { kind, original, current } = props;
  const diff = kind === "math" ? diffCharacters : diffWords;
  return (
    <code className="emr-generated-source-code-diff">
      {diff(original, current).map((op, i) => {
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
      })}
    </code>
  );
}
