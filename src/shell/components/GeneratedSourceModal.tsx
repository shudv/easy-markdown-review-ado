// Shared Source callout for rendered Mermaid diagrams and KaTeX equations.
// Before selects the historical version; Changes independently annotates the
// current source and is hidden while Before is active.

import * as React from "react";

import { hydrateMath } from "../../markdown/mathHydrate";
import { hydrateMermaid } from "../../markdown/mermaidHydrate";
import { events, track } from "../../telemetry";
import {
  GeneratedSourceDiff,
  GeneratedSourceIdentity,
  GeneratedSourceViewControls,
} from "./GeneratedSourceModal.parts";

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

// eslint-disable-next-line max-lines-per-function -- Generated-source dialog: header, view toggle and source/diff panes share the dialog state and focus handling.
export function GeneratedSourceModal(
  props: Readonly<GeneratedSourceModalProps>,
): React.ReactElement | null {
  const { kind = "mermaid", source, originalSource, onClose } = props;
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const hasDiff =
    source !== null && originalSource != null && originalSource !== source;
  const {
    copied,
    setCopied,
    beforeShown,
    setBeforeShown,
    changesShown,
    setChangesShown,
  } = useGeneratedSourceViewState(hasDiff, kind, source);
  const selectedSource =
    beforeShown && originalSource != null ? originalSource : source;

  // Move focus into the dialog when it opens and give it back to whatever
  // opened it (the article's "Source" button) when it closes.
  const isOpen = source !== null;
  React.useEffect(() => {
    if (!isOpen) return;
    // `activeElement` is at least <body> while a document is loaded.
    const opener = document.activeElement as HTMLElement;
    panelRef.current!.focus();
    return () => opener.focus();
  }, [isOpen]);

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
      const code = document.createElement("code");
      code.textContent = selectedSource;
      const fallback = document.createElement("pre");
      fallback.className = "emr-math-fallback";
      fallback.append(code);
      const math = document.createElement("div");
      math.className = "emr-math emr-math--display";
      math.setAttribute("data-math-src", encoded);
      math.setAttribute("data-math-display", "true");
      math.append(fallback);
      el.replaceChildren(math);
      void hydrateMath(el);
    } else {
      const mermaid = document.createElement("div");
      mermaid.className = "emr-mermaid";
      mermaid.setAttribute("data-mermaid-src", encoded);
      el.replaceChildren(mermaid);
      void hydrateMermaid(el);
    }
  }, [kind, selectedSource]);

  if (source === null) return null;

  const copy = () => {
    track(
      kind === "math"
        ? events.mathSourceCopied()
        : events.mermaidSourceCopied(),
    );
    // `navigator.clipboard` is undefined at runtime outside secure contexts,
    // although the DOM typings declare it always present.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    void clipboard?.writeText(selectedSource!).then(
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
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions -- Modal backdrop: the click only closes on clicks outside the dialog panel. Keyboard users get focus moved into the panel on open and close with Escape.
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
      <div className="emr-generated-source-modal" ref={panelRef} tabIndex={-1}>
        <div className="emr-generated-source-header">
          <GeneratedSourceIdentity kind={kind} />
          <div className="emr-generated-source-actions">
            {hasDiff ? (
              <GeneratedSourceViewControls
                beforeShown={beforeShown}
                changesShown={changesShown}
                onToggleBefore={() => setBeforeShown((shown) => !shown)}
                onToggleChanges={() => setChangesShown((shown) => !shown)}
              />
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
            {!beforeShown && changesShown && hasDiff ? (
              <GeneratedSourceDiff
                kind={kind}
                original={originalSource}
                current={source}
              />
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

/**
 * View toggles + copy feedback, reset whenever the shown source changes. Uses
 * the "adjust state during render" pattern so a new source never renders
 * with the previous source's toggles.
 */
function useGeneratedSourceViewState(
  hasDiff: boolean,
  kind: string,
  source: string | null,
) {
  const [copied, setCopied] = React.useState(false);
  const [beforeShown, setBeforeShown] = React.useState(false);
  const [changesShown, setChangesShown] = React.useState(hasDiff);
  const [shown, setShown] = React.useState({ hasDiff, kind, source });
  if (
    shown.hasDiff !== hasDiff ||
    shown.kind !== kind ||
    shown.source !== source
  ) {
    setShown({ hasDiff, kind, source });
    setCopied(false);
    setBeforeShown(false);
    setChangesShown(hasDiff);
  }
  return {
    copied,
    setCopied,
    beforeShown,
    setBeforeShown,
    changesShown,
    setChangesShown,
  };
}
