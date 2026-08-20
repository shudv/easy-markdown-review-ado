// Floating typeahead popover for `@user`, `#workitem`, and `!pullrequest`
// mentions, rendered near the composer textarea while mid-mention. The Composer
// owns query/suggestions/selectedIndex state and drives keyboard nav via props
// so it can intercept keys before the textarea sees them.

import * as React from "react";

import type { MentionKind, MentionSuggestion } from "../../comments/mentions";
import { Avatar } from "./Avatar";

export interface MentionPickerProps {
  kind: MentionKind;
  query: string;
  suggestions: MentionSuggestion[];
  loading: boolean;
  /** Top-left pixel coordinates relative to viewport. */
  top: number;
  left: number;
  /** Max width hint (typically the textarea width). */
  maxWidth?: number;
  selectedIndex: number;
  onSelectedIndexChange: (i: number) => void;
  onSelect: (suggestion: MentionSuggestion) => void;
  onCancel: () => void;
}

export function MentionPicker(props: MentionPickerProps): React.ReactElement {
  const {
    kind,
    query,
    suggestions,
    loading,
    top,
    left,
    maxWidth,
    selectedIndex,
    onSelectedIndexChange,
    onSelect,
    onCancel,
  } = props;

  // Scroll the selected row into view when it changes (for arrow-key nav).
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const list = listRef.current!;
    const sel = list.querySelector<HTMLElement>(
      `[data-mp-index="${selectedIndex}"]`,
    );
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close on outside click. We don't close on textarea focus loss — the parent
  // handles that via its own state.
  React.useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      const root = listRef.current!;
      if (!root.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", onDocMouseDown, true);
  }, [onCancel]);

  const style: React.CSSProperties = {
    position: "fixed",
    top,
    left,
    maxWidth: maxWidth ?? 360,
    minWidth: 240,
  };

  const headerLabel =
    kind === "user"
      ? "People"
      : kind === "workitem"
        ? "Work items"
        : "Pull requests";

  return (
    <div
      ref={listRef}
      className={`emr-mention-picker emr-mention-picker-${kind}`}
      role="listbox"
      aria-label={`${headerLabel} matching ${query}`}
      style={style}
      // Don't steal focus from the textarea on click — it must keep focus so
      // caret tracking keeps working.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="emr-mention-picker-header">{headerLabel}</div>
      {loading && suggestions.length === 0 ? (
        <div className="emr-mention-picker-empty">Searching…</div>
      ) : suggestions.length === 0 ? (
        <div className="emr-mention-picker-empty">No matches</div>
      ) : (
        <div className="emr-mention-picker-list" role="presentation">
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}:${s.id}`}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-mp-index={i}
              className={
                "emr-mention-picker-row" +
                (i === selectedIndex ? " is-selected" : "")
              }
              onMouseEnter={() => onSelectedIndexChange(i)}
              onClick={() => onSelect(s)}
            >
              <SuggestionRow suggestion={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind row renderers
// ---------------------------------------------------------------------------

function SuggestionRow({
  suggestion,
}: {
  suggestion: MentionSuggestion;
}): React.ReactElement {
  switch (suggestion.kind) {
    case "user":
      return (
        <>
          <Avatar
            author={{
              id: suggestion.id,
              displayName: suggestion.displayName,
              initials: suggestion.initials,
              avatarUrl: suggestion.avatarUrl,
            }}
          />
          <span className="emr-mention-picker-body">
            <span className="emr-mention-picker-primary">
              {suggestion.displayName}
            </span>
            {suggestion.secondary ? (
              <span className="emr-mention-picker-secondary">
                {suggestion.secondary}
              </span>
            ) : null}
          </span>
        </>
      );
    case "workitem":
      return (
        <>
          <span
            className="emr-mention-picker-type"
            aria-hidden="true"
            data-wi-type={suggestion.workItemType.toLowerCase()}
          >
            {workItemGlyph(suggestion.workItemType)}
          </span>
          <span className="emr-mention-picker-body">
            <span className="emr-mention-picker-primary">
              <span className="emr-mention-picker-id">#{suggestion.id}</span>{" "}
              {suggestion.title}
            </span>
            <span className="emr-mention-picker-secondary">
              <span
                className="emr-mention-state-dot"
                style={
                  suggestion.stateColor
                    ? { background: suggestion.stateColor }
                    : undefined
                }
                aria-hidden="true"
              />
              {suggestion.state}
              <span className="emr-mention-picker-sep">·</span>
              {suggestion.workItemType}
            </span>
          </span>
        </>
      );
    case "pullrequest":
      return (
        <>
          <span
            className="emr-mention-picker-type emr-mention-picker-type-pr"
            aria-hidden="true"
          >
            PR
          </span>
          <span className="emr-mention-picker-body">
            <span className="emr-mention-picker-primary">
              <span className="emr-mention-picker-id">!{suggestion.id}</span>{" "}
              {suggestion.title}
            </span>
            <span className="emr-mention-picker-secondary">
              <span
                className={
                  "emr-mention-state-dot emr-pr-state-" + suggestion.status
                }
                aria-hidden="true"
              />
              {prStatusLabel(suggestion.status)}
              {suggestion.repository ? (
                <>
                  <span className="emr-mention-picker-sep">·</span>
                  {suggestion.repository}
                </>
              ) : null}
            </span>
          </span>
        </>
      );
  }
}

function workItemGlyph(type: string): string {
  // Map common WI types to a single letter so we don't ship a sprite sheet.
  // The CSS uses `data-wi-type` to tint each type appropriately.
  const t = type.toLowerCase();
  if (t.includes("bug")) return "B";
  if (t.includes("task")) return "T";
  if (t.includes("story") || t.includes("scenario")) return "S";
  if (t.includes("feature")) return "F";
  if (t.includes("epic")) return "E";
  return type.charAt(0).toUpperCase();
}

function prStatusLabel(s: "active" | "completed" | "abandoned"): string {
  switch (s) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "abandoned":
      return "Abandoned";
  }
}
