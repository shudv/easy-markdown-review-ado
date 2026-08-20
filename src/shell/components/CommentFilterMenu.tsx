// The rail's comment filter — the "Comments" header IS the dropdown.
//
// The header label doubles as the trigger: it shows the active filter (e.g.
// "All comments") with a chevron, and opening it reveals a small popover with
// two sections — the status modes (all / active / resolved / mine, single
// choice) and, below a divider, a "Only comments on this file" toggle that
// combines with any mode. This frees the header of a separate funnel icon; the
// comment count lives in the prev/next cycler. Escape or an outside click
// closes it — mirroring Azure DevOps's PR comment filter, sized for our rail.

import * as React from "react";

import {
  commentFilterLabel,
  commentFilterOptions,
  type CommentFilterCounts,
  type CommentFilterMode,
} from "./commentFilter";

interface CommentFilterMenuProps {
  /** The active status filter mode. */
  mode: CommentFilterMode;
  /** Live per-bucket counts, shown on each menu item. */
  counts: CommentFilterCounts;
  /** Called with the chosen mode when a status option is picked. */
  onChange: (mode: CommentFilterMode) => void;
  /** Whether the "only comments on this file" scope toggle is on. */
  onlyThisFile: boolean;
  /** Toggle the "only this file" scope. */
  onOnlyThisFileChange: (next: boolean) => void;
}

export function CommentFilterMenu(
  props: CommentFilterMenuProps,
): React.ReactElement {
  const { mode, counts, onChange, onlyThisFile, onOnlyThisFileChange } = props;
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        menuRef.current &&
        target &&
        !menuRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = commentFilterOptions(counts);
  const activeLabel = commentFilterLabel(mode);

  return (
    <div className="emr-comment-filter">
      <button
        ref={btnRef}
        type="button"
        className={`emr-rail-filter-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filter comments — ${activeLabel}${
          onlyThisFile ? ", hiding comments not on this file" : ""
        }`}
        title="Filter comments"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="emr-rail-filter-label">{activeLabel}</span>
        <SvgChevronDown />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="emr-popover emr-comment-filter-menu"
          role="menu"
          aria-label="Filter comments"
        >
          <div
            className="emr-comment-filter-group"
            role="group"
            aria-label="Which comments"
          >
            {options.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                role="menuitemradio"
                aria-checked={opt.mode === mode}
                className={`emr-popover-item emr-comment-filter-option${
                  opt.mode === mode ? " is-selected" : ""
                }`}
                onClick={() => {
                  onChange(opt.mode);
                  setOpen(false);
                }}
              >
                <span className="emr-comment-filter-check" aria-hidden="true">
                  {opt.mode === mode ? <SvgCheck /> : null}
                </span>
                <span className="emr-comment-filter-option-label">
                  {opt.label}
                </span>
                <span className="emr-comment-filter-option-count">
                  {opt.count}
                </span>
              </button>
            ))}
          </div>
          <div className="emr-comment-filter-sep" role="separator" />
          <div
            className="emr-comment-filter-group"
            role="group"
            aria-label="Scope"
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={onlyThisFile}
              className={`emr-popover-item emr-comment-filter-option${
                onlyThisFile ? " is-selected" : ""
              }`}
              onClick={() => onOnlyThisFileChange(!onlyThisFile)}
            >
              <span className="emr-comment-filter-check" aria-hidden="true">
                {onlyThisFile ? <SvgCheck /> : null}
              </span>
              <span className="emr-comment-filter-option-label">
                Hide comments not on this file
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const iconStrokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SvgChevronDown(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      className="emr-rail-filter-caret"
      {...iconStrokeProps}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SvgCheck(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
