// DraftGuardDialog — a small blocking confirm shown when the reviewer tries to
// open a second comment composer while an in-progress draft still holds text.
// Enforces the "one active draft per experience" rule without silently losing
// work: the reviewer explicitly discards the existing draft or keeps editing
// it. Shows the draft's file + a text snippet so they know exactly what's at
// stake.

import * as React from "react";

interface DraftGuardDialogProps {
  /** File the existing draft lives in (basename shown to the user). */
  fileName: string;
  /** One-line snippet of the existing draft's text. */
  snippet: string;
  /** Discard the existing draft and proceed with the new composer. */
  onDiscard: () => void;
  /** Dismiss the dialog and keep the existing draft intact. */
  onKeepEditing: () => void;
}

export function DraftGuardDialog(
  props: DraftGuardDialogProps,
): React.ReactElement {
  const { fileName, snippet, onDiscard, onKeepEditing } = props;

  const keepRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    keepRef.current?.focus();
  }, []);

  // Escape keeps the draft (the safe default).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onKeepEditing();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onKeepEditing]);

  return (
    <div
      className="emr-draft-guard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved comment draft"
      onClick={(e) => {
        if (e.target === e.currentTarget) onKeepEditing();
      }}
    >
      <div className="emr-draft-guard">
        <div className="emr-draft-guard-title">
          You already have an unsaved comment
        </div>
        <div className="emr-draft-guard-body">
          <p>
            There's an unsaved draft in <strong>{fileName}</strong>. Starting a
            new one will discard it.
          </p>
          <blockquote className="emr-draft-guard-snippet">{snippet}</blockquote>
        </div>
        <div className="emr-draft-guard-actions">
          <button type="button" className="emr-btn subtle" onClick={onDiscard}>
            Discard draft
          </button>
          <button
            ref={keepRef}
            type="button"
            className="emr-btn primary"
            onClick={onKeepEditing}
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}
