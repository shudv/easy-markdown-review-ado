// ReaderStatusBar — the reader's single, docked control surface. A slim strip
// pinned to the bottom of the reader (Word's status-bar model), spanning the
// full reader width. It replaces the old floating DocToolbar: every reading
// control now lives here.
//
//   left  — document status: word count + the PR word-count delta.
//   right — Navigation · Comments · Changes toggles, an "Aa" reading-font /
//           spacing popover, a text-size slider, Refresh, and Feedback.
//
// All state lives with the host (PrShell) and arrives via props; this component
// owns only the transient font-popover open state.

import * as React from "react";

import {
  clampReaderPct,
  DEFAULT_FONT_ID,
  detectAvailableReaderFonts,
  nudgeReaderPct,
  READER_FONTS,
  READER_PERCENT_MAX,
  READER_PERCENT_MIN,
  READER_SPACING_UI_MAX,
  READER_SPACING_UI_MIN,
  snapReaderPct,
} from "../readerPrefs";
import {
  allReviewIterations,
  betweenReviewUpdates,
  oneReviewUpdate,
  resolveReviewIterationRange,
  type ReviewIterationRange,
  type WordCountDelta,
  type WordDeltaPart,
} from "../prShellHelpers";
import {
  baseCommitTitle,
  iterationOptionClassName,
  iterationPickerModel,
  statusBarVisibility,
  type StatusBarVisibility,
} from "./readerStatusBarModel";
import {
  ReaderActivityIndicator,
  selectReaderActivity,
  useDelayedReaderActivity,
  type ReaderActivity,
} from "./readerActivity";

export interface ReaderStatusBarProps {
  /** Approximate word count of the current document (0/undefined hides it). */
  wordCount?: number;
  /** Words the PR added / removed; shown as a delta when the diff is on. */
  wordDelta?: WordCountDelta;
  /** Latest completed PR associated with the active Documents Hub document. */
  resolvedPullRequest?: {
    prId: number;
    title: string;
    url?: string;
  };

  /** Selected reading-font id (see `READER_FONTS`). */
  fontId: string;
  /** Selected text size as a continuous percentage. */
  sizePct: number;
  /** Selected combined text spacing percentage. */
  spacingPct: number;
  /** Choose a reading font. */
  onFontChange: (fontId: string) => void;
  /** Set the continuous text-size percentage. */
  onSizeChange: (sizePct: number) => void;
  /** Set the combined text-spacing percentage. */
  onSpacingChange: (spacingPct: number) => void;
  /** Optional deterministic availability override for embeds and tests. */
  availableFontIds?: readonly string[];

  /** Whether the document-navigation panel is currently shown. */
  showNav: boolean;
  /** Toggle the document-navigation panel. */
  onToggleNav: () => void;
  /** False in single-file mode (no file tree) — drops the Navigation control. */
  navToggleable: boolean;
  /** Whether the open document's outline is listed in the navigation panel. */
  showOutline?: boolean;
  /**
   * Toggle the navigation outline. Offered next to Navigation while the panel
   * is shown; omitted drops the control.
   */
  onToggleOutline?: () => void;

  /** Whether the comments panel is currently shown. */
  showComments: boolean;
  /** Whether the active surface has a resolved comment target. */
  commentsAvailable?: boolean;
  /** Toggle the comments panel. */
  onToggleComments: () => void;
  /** Visible comment thread ids in cycle order. */
  commentThreadIds?: readonly string[];
  /** Currently selected visible comment thread. */
  activeCommentThreadId?: string | null;
  /** Select a comment while cycling. */
  onCycleComment?: (threadId: string) => void;

  /** Whether the document has changes to show (a PR diff). */
  changesAvailable: boolean;
  /** Whether change highlights are currently shown. */
  changesShown: boolean;
  /** Toggle the change highlights. */
  onToggleChanges: () => void;

  /**
   * Chronological pull-request updates, oldest first. (The picker lists them
   * newest first, under "All updates", like ADO's own update list.)
   */
  iterationOptions?: readonly ReaderIterationOption[];
  /** Pull-request base commit shown by the base-comparison glyph tooltip. */
  iterationBaseCommit?: string;
  /** Current native-PR update comparison interval. */
  iterationRange?: ReviewIterationRange;
  /** Replace the current update comparison interval. */
  onIterationRangeChange?: (range: ReviewIterationRange) => void;

  /** `mailto:`/https feedback target. Omitted drops the Feedback control. */
  feedbackHref?: string;

  /** Refresh the document data + comments. Omitted drops the control. */
  onRefresh?: () => void;
  /** Whether a refresh is in flight — spins the icon and disables the button. */
  refreshing?: boolean;
  /** Tooltip / aria-label for the refresh control. */
  refreshLabel?: string;
  /** Concurrent reader operations eligible for the centered activity display. */
  activities?: readonly ReaderActivity[];
  /** Anti-flicker delay before an activity is announced. Defaults to 250ms. */
  activityDelayMs?: number;
}

export interface ReaderIterationOption {
  /** Index used by PrShell's newest-first `historyStops` array. */
  stopIndex: number;
  /** Chronological display position (oldest = 1). */
  number: number;
  /** Pull-request / commit message for this stop. */
  title: string;
  /** Epoch milliseconds, when known. */
  dateMs?: number;
}

// ---- Icons (24-viewBox, stroke = currentColor) ----------------------------

function IconNav(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function IconComments(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-11.5 7.8L3 21l1.7-6.5A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}

function IconChanges(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.5v13" />
      <path d="M5.5 9h13" />
      <path d="M5.5 21h13" />
    </svg>
  );
}

function IconCaret(): React.ReactElement {
  return (
    <svg
      className="emr-statusbar-caret"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function IconChevron({
  direction,
}: {
  direction: "left" | "right";
}): React.ReactElement {
  return (
    <svg
      className="emr-statusbar-iteration-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function StatusBarSeparator(): React.ReactElement {
  return <div className="emr-statusbar-sep" aria-hidden="true" />;
}

function IconOutline(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M5 6h14" />
      <path d="M9 12h10" />
      <path d="M9 18h10" />
    </svg>
  );
}

/**
 * Opt-in toggle for the heading outline under the open document in the
 * navigation panel. Only offered while that panel is shown.
 */
function OutlineToggle(props: {
  navToggleable: boolean;
  navShown: boolean;
  shown: boolean;
  onToggle: (() => void) | undefined;
}): React.ReactElement | null {
  const { navToggleable, navShown, shown, onToggle } = props;
  if (!navToggleable || !navShown || !onToggle) return null;
  return (
    <button
      type="button"
      className="emr-statusbar-btn emr-statusbar-outline is-toggle"
      aria-pressed={shown}
      title={
        shown
          ? "Hide the document outline in the navigation"
          : "Show the document outline in the navigation"
      }
      onClick={onToggle}
    >
      <IconOutline />
      <span className="emr-sr-only">Outline</span>
    </button>
  );
}

interface CommentStepperProps {
  threadIds: readonly string[];
  activeThreadId: string | null;
  onCycle: (threadId: string) => void;
}

function CommentStepper({
  threadIds,
  activeThreadId,
  onCycle,
}: CommentStepperProps): React.ReactElement {
  const total = threadIds.length;
  const activeIndex = activeThreadId ? threadIds.indexOf(activeThreadId) : -1;
  const cycle = (direction: -1 | 1) => {
    const nextIndex =
      activeIndex < 0
        ? direction < 0
          ? total - 1
          : 0
        : (activeIndex + direction + total) % total;
    onCycle(threadIds[nextIndex]!);
  };

  return (
    <div
      className="emr-statusbar-comment-stepper"
      aria-label="Comment navigation"
    >
      <button
        type="button"
        className="emr-statusbar-comment-step"
        title="Previous comment"
        aria-label="Previous comment"
        onClick={() => cycle(-1)}
      >
        <IconChevron direction="left" />
      </button>
      <span
        className="emr-statusbar-comment-count"
        aria-live="polite"
        aria-label={
          activeIndex >= 0
            ? `Comment ${activeIndex + 1} of ${total}`
            : `${total} comments`
        }
      >
        <span className="emr-statusbar-comment-count-sizer" aria-hidden="true">
          {total} / {total}
        </span>
        <span className="emr-statusbar-comment-count-value">
          {activeIndex >= 0 ? activeIndex + 1 : "—"} / {total}
        </span>
      </span>
      <button
        type="button"
        className="emr-statusbar-comment-step"
        title="Next comment"
        aria-label="Next comment"
        onClick={() => cycle(1)}
      >
        <IconChevron direction="right" />
      </button>
    </div>
  );
}

function IconCheck(): React.ReactElement {
  return (
    <svg
      className="emr-statusbar-font-check"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconPullRequest(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10" />
      <path d="M18 7v3a5 5 0 0 1-5 5h-3" />
    </svg>
  );
}

function IconFeedback(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 3 1.5 1.7" />
      <path d="M16 3l-1.5 1.7" />
      <path d="M9.2 7.5v-.8a2.8 2.8 0 0 1 5.6 0v.8" />
      <path d="M12 20.5c-3.2 0-5.6-2.6-5.6-5.8v-2.9A3.8 3.8 0 0 1 10.2 8h3.6a3.8 3.8 0 0 1 3.8 3.8v2.9c0 3.2-2.4 5.8-5.6 5.8z" />
      <path d="M12 20.5V11" />
      <path d="M6.4 12H3" />
      <path d="M21 12h-3.4" />
      <path d="M6.6 8.4C5 8.2 3.7 6.9 3.5 5.2" />
      <path d="M17.4 8.4c1.6-.2 2.9-1.5 3.1-3.2" />
      <path d="M6.4 16.2C4.9 16.4 3.7 17.7 3.5 19.4" />
      <path d="M17.6 16.2c1.5.2 2.7 1.5 2.9 3.2" />
    </svg>
  );
}

function IconRefresh(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** A CSS class per font id so each list row renders in its own face. */
function fontClass(id: string): string {
  return `emr-font-${id}`;
}

function formatIterationAge(dateMs: number | undefined): string | null {
  if (dateMs === undefined) return null;
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - dateMs) / 60_000),
  );
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function formatIterationTimestamp(dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dateMs);
}

interface IterationPickerProps {
  options: readonly ReaderIterationOption[];
  baseCommit?: string;
  range: ReviewIterationRange;
  onChange: (range: ReviewIterationRange) => void;
}

function useInertPopover(open: boolean): {
  triggerRef: React.RefObject<HTMLButtonElement>;
  popoverRef: React.RefObject<HTMLDivElement>;
  restoreFocusAfterClose: () => void;
} {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef(false);
  const restoreFocusAfterClose = React.useCallback(() => {
    restoreFocusRef.current = true;
  }, []);

  React.useLayoutEffect(() => {
    popoverRef.current!.inert = !open;
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  return {
    triggerRef,
    popoverRef,
    restoreFocusAfterClose,
  };
}

function handlePopoverEscape(
  event: KeyboardEvent,
  restoreFocusAfterClose: () => void,
  close: () => void,
): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  restoreFocusAfterClose();
  close();
}

/** The picker's previous (left) / next (right) comparison step. */
function IterationStepButton({
  direction,
  label,
  range,
  onStep,
}: {
  direction: "left" | "right";
  label: string | null;
  range: ReviewIterationRange | null;
  onStep: (range: ReviewIterationRange) => void;
}): React.ReactElement {
  const word = direction === "left" ? "Previous" : "Next";
  const edge = direction === "left" ? "First" : "Last";
  return (
    <button
      type="button"
      className="emr-statusbar-iteration-step"
      aria-label={
        label
          ? `${word} comparison: ${label}`
          : `No ${word.toLowerCase()} comparison`
      }
      title={label ? `${word}: ${label}` : `${edge} comparison`}
      disabled={!range}
      onClick={range ? () => onStep(range) : undefined}
    >
      <IconChevron direction={direction} />
    </button>
  );
}

function IterationPicker({
  options,
  baseCommit,
  range,
  onChange,
}: IterationPickerProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const anchorUpdateRef = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const { triggerRef, popoverRef, restoreFocusAfterClose } =
    useInertPopover(open);
  const {
    resolved,
    allChangesSelected,
    baseComparison,
    firstSelectedUpdate,
    selectionLabel,
    stableLabels,
    previousRange,
    nextRange,
    previousLabel,
    nextLabel,
    triggerTitle,
  } = iterationPickerModel(options, range);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current!.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      handlePopoverEscape(event, restoreFocusAfterClose, () => setOpen(false));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, restoreFocusAfterClose]);

  // On open, bring the current selection into view: the list is newest-first,
  // so the first selected row is the comparison's newest update. A long PR
  // would otherwise open scrolled away from where the reviewer is.
  React.useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current!;
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
    /* v8 ignore next -- some option (All updates at least) is always selected */
    if (!selected) return;
    const offset =
      selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += offset - (list.clientHeight - selected.offsetHeight) / 2;
  }, [open]);

  const stepTo = (nextRange: ReviewIterationRange) => {
    const nextResolved = resolveReviewIterationRange(nextRange, options.length);
    anchorUpdateRef.current = nextResolved.isAllChanges
      ? null
      : nextResolved.range.toUpdate;
    onChange(nextRange);
  };

  return (
    <div
      ref={rootRef}
      className={`emr-statusbar-iteration${open ? " is-open" : ""}`}
    >
      <div className="emr-statusbar-iteration-stepper">
        <IterationStepButton
          direction="left"
          label={previousLabel}
          range={previousRange}
          onStep={stepTo}
        />
        <div className="emr-statusbar-iteration-trigger-slot">
          <span
            className="emr-statusbar-iteration-trigger-sizer"
            aria-hidden="true"
          >
            <span className="emr-statusbar-iteration-base">
              <span className="emr-statusbar-iteration-base-dot" />
            </span>
            <span>→</span>
            <span>Update {options.length}</span>
          </span>
          {stableLabels.map((label) => (
            <span
              key={label}
              className="emr-statusbar-iteration-trigger-sizer"
              aria-hidden="true"
            >
              <span>{label}</span>
            </span>
          ))}
          <button
            ref={triggerRef}
            type="button"
            className="emr-statusbar-iteration-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={baseComparison ? selectionLabel : undefined}
            title={triggerTitle}
            onClick={() => {
              if (
                !open &&
                anchorUpdateRef.current === null &&
                !allChangesSelected
              ) {
                anchorUpdateRef.current = resolved.range.toUpdate;
              }
              setOpen((value) => !value);
            }}
          >
            <span className="emr-statusbar-iteration-value">
              {baseComparison ? (
                <>
                  <span
                    className="emr-statusbar-iteration-base"
                    title={baseCommitTitle(baseCommit)}
                    aria-hidden="true"
                  >
                    <span className="emr-statusbar-iteration-base-dot" />
                  </span>
                  <span
                    className="emr-statusbar-iteration-text"
                    aria-hidden="true"
                  >
                    →
                  </span>
                  <span
                    className="emr-statusbar-iteration-text"
                    aria-hidden="true"
                  >
                    Update {resolved.range.toUpdate}
                  </span>
                </>
              ) : (
                <span className="emr-statusbar-iteration-text">
                  {selectionLabel}
                </span>
              )}
            </span>
          </button>
        </div>
        <IterationStepButton
          direction="right"
          label={nextLabel}
          range={nextRange}
          onStep={stepTo}
        />
      </div>
      <div
        ref={popoverRef}
        className="emr-statusbar-iteration-pop"
        role="presentation"
        aria-hidden={!open}
      >
        <div
          ref={listRef}
          className="emr-statusbar-iteration-list"
          role="listbox"
          aria-label="Review iterations"
          aria-multiselectable="true"
        >
          {/* Newest first, like ADO's own update list: "All updates" on top,
              then the latest update down to the first. */}
          <button
            type="button"
            role="option"
            aria-selected={allChangesSelected}
            className="emr-statusbar-iteration-option is-all-changes"
            onClick={() => {
              anchorUpdateRef.current = null;
              onChange(allReviewIterations(options.length));
            }}
          >
            <span className="emr-statusbar-iteration-num" />
            <span className="emr-statusbar-iteration-title">All updates</span>
            <span />
          </button>
          {[...options].reverse().map((option) => {
            const isSelected =
              !allChangesSelected &&
              option.number >= firstSelectedUpdate &&
              option.number <= resolved.range.toUpdate;
            const age = formatIterationAge(option.dateMs);
            return (
              <button
                key={option.stopIndex}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={iterationOptionClassName(option.number, isSelected, {
                  firstSelectedUpdate,
                  toUpdate: resolved.range.toUpdate,
                })}
                title={option.title}
                onClick={(event) => {
                  if (event.shiftKey && !allChangesSelected) {
                    onChange(
                      betweenReviewUpdates(
                        anchorUpdateRef.current!,
                        option.number,
                        options.length,
                      ),
                    );
                  } else {
                    anchorUpdateRef.current = option.number;
                    onChange(oneReviewUpdate(option.number, options.length));
                  }
                }}
              >
                <span className="emr-statusbar-iteration-num">
                  {option.number}
                </span>
                <span className="emr-statusbar-iteration-title">
                  {option.title}
                </span>
                {age ? (
                  <time
                    className="emr-statusbar-iteration-date"
                    dateTime={new Date(option.dateMs!).toISOString()}
                    title={formatIterationTimestamp(option.dateMs!)}
                  >
                    {age}
                  </time>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

async function loadLocalReaderFont(
  family: string,
  id: string,
): Promise<boolean> {
  if (typeof FontFace !== "function") return false;
  const face = new FontFace(
    `emr-local-probe-${id}`,
    `local(${JSON.stringify(family)})`,
  );
  await face.load();
  return face.status === "loaded";
}

interface PercentSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  fluid?: boolean;
  min?: number;
  max?: number;
  showDefaultMarker?: boolean;
}

function PercentSlider({
  label,
  value,
  onChange,
  fluid = false,
  min = READER_PERCENT_MIN,
  max = READER_PERCENT_MAX,
  showDefaultMarker = true,
}: PercentSliderProps): React.ReactElement {
  const displayValue = Math.max(min, Math.min(max, value));
  const progress = ((displayValue - min) / (max - min)) * 100;
  const defaultPosition = ((100 - min) / (max - min)) * 100;
  const nudge = (dir: number) =>
    onChange(nudgeReaderPct(displayValue, dir, min, max));
  const style = {
    "--emr-percent-progress": `${progress}%`,
    "--emr-percent-default-position": `${defaultPosition}%`,
  } as React.CSSProperties;

  return (
    <div
      className={`emr-percent-slider${fluid ? " is-fluid" : ""}`}
      style={style}
    >
      <button
        className="emr-percent-adjust is-minus"
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={displayValue <= min}
        onClick={() => nudge(-1)}
      />
      <span className="emr-percent-track">
        <input
          type="range"
          aria-label={label}
          aria-valuetext={`${displayValue}%`}
          min={min}
          max={max}
          step="1"
          value={displayValue}
          onChange={(event) =>
            onChange(snapReaderPct(Number(event.currentTarget.value), min, max))
          }
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? -1
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? 1
                  : 0;
            if (delta === 0) return;
            event.preventDefault();
            onChange(clampReaderPct(displayValue + delta, min, max));
          }}
        />
        {showDefaultMarker ? (
          <span className="emr-percent-default-marker" aria-hidden="true" />
        ) : null}
      </span>
      <button
        className="emr-percent-adjust is-plus"
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={displayValue >= max}
        onClick={() => nudge(1)}
      />
      <output className="emr-percent-output">{displayValue}%</output>
    </div>
  );
}

/** Document-position status: the word count and the PR word-count delta. */
function WordStatus({
  wordCount,
  hasCount,
  deltaParts,
}: {
  wordCount: number | undefined;
  hasCount: boolean;
  deltaParts: readonly WordDeltaPart[];
}): React.ReactElement {
  return (
    <div className="emr-statusbar-status">
      {hasCount ? (
        <span className="emr-statusbar-words">
          <b>{wordCount!.toLocaleString()}</b> words
        </span>
      ) : null}
      {deltaParts.length > 0 ? (
        <span className="emr-statusbar-delta">
          {deltaParts.map((part) => (
            <span
              key={part.kind}
              className={
                part.kind === "added"
                  ? "emr-statusbar-delta-add"
                  : "emr-statusbar-delta-rem"
              }
              aria-label={part.a11y}
            >
              {part.label}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** PR-comparison controls: the update picker and the Changes toggle. */
function ContextControls(props: {
  showIterationPicker: boolean;
  iterationOptions: ReaderStatusBarProps["iterationOptions"];
  iterationBaseCommit: string | undefined;
  iterationRange: ReviewIterationRange | undefined;
  onIterationRangeChange: ReaderStatusBarProps["onIterationRangeChange"];
  changesAvailable: boolean;
  changesShown: boolean;
  onToggleChanges: () => void;
}): React.ReactElement {
  const { changesAvailable, changesShown, onToggleChanges } = props;
  return (
    <div className="emr-statusbar-context-controls">
      {props.showIterationPicker ? (
        <IterationPicker
          options={props.iterationOptions!}
          baseCommit={props.iterationBaseCommit}
          range={props.iterationRange!}
          onChange={props.onIterationRangeChange!}
        />
      ) : null}
      {changesAvailable ? (
        <button
          type="button"
          className="emr-statusbar-btn emr-statusbar-changes is-toggle"
          aria-pressed={changesShown}
          title={
            changesShown
              ? "Hide the change highlights"
              : "Show what changed in this pull request"
          }
          onClick={onToggleChanges}
        >
          <IconChanges />
          <span className="emr-sr-only">Changes</span>
        </button>
      ) : null}
    </div>
  );
}

/** Left side: Navigation / Outline toggles, comparison controls, status. */
function StatusBarLeft({
  props,
  visibility,
}: {
  props: ReaderStatusBarProps;
  visibility: StatusBarVisibility;
}): React.ReactElement {
  const { navToggleable, showNav } = props;
  const { hasCount, deltaParts, showIterationPicker, showContextControls } =
    visibility;
  const hasStatus = hasCount || deltaParts.length > 0;
  return (
    <div className="emr-statusbar-left">
      {navToggleable ? (
        <button
          type="button"
          className="emr-statusbar-btn is-toggle"
          aria-pressed={showNav}
          title={showNav ? "Hide navigation" : "Show navigation"}
          onClick={props.onToggleNav}
        >
          <IconNav />
          <span className="emr-statusbar-btn-label">Navigation</span>
        </button>
      ) : null}
      <OutlineToggle
        navToggleable={navToggleable}
        navShown={showNav}
        shown={props.showOutline === true}
        onToggle={props.onToggleOutline}
      />
      {navToggleable && (showContextControls || hasStatus) ? (
        <StatusBarSeparator />
      ) : null}
      {showContextControls ? (
        <ContextControls
          showIterationPicker={showIterationPicker}
          iterationOptions={props.iterationOptions}
          iterationBaseCommit={props.iterationBaseCommit}
          iterationRange={props.iterationRange}
          onIterationRangeChange={props.onIterationRangeChange}
          changesAvailable={props.changesAvailable}
          changesShown={props.changesShown}
          onToggleChanges={props.onToggleChanges}
        />
      ) : null}
      {showContextControls && hasStatus ? <StatusBarSeparator /> : null}

      <WordStatus
        wordCount={props.wordCount}
        hasCount={hasCount}
        deltaParts={deltaParts}
      />
    </div>
  );
}

/** Badge linking the latest completed PR for the open Documents Hub file. */
function ResolvedPullRequestBadge({
  pullRequest,
}: {
  pullRequest: ReaderStatusBarProps["resolvedPullRequest"];
}): React.ReactElement | null {
  if (!pullRequest) return null;
  const label = `Latest completed PR for this file: #${pullRequest.prId} ${pullRequest.title}`;
  const content = (
    <>
      <IconPullRequest />
      <span>PR #{pullRequest.prId}</span>
    </>
  );
  return pullRequest.url ? (
    <a
      className="emr-statusbar-resolved-pr"
      href={pullRequest.url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
    >
      {content}
    </a>
  ) : (
    <span
      className="emr-statusbar-resolved-pr"
      title={label}
      aria-label={label}
    >
      {content}
    </span>
  );
}

/** Comment stepper, Comments toggle, and the resolved-PR badge. */
function CommentControls({
  props,
  showCommentStepper,
}: {
  props: ReaderStatusBarProps;
  showCommentStepper: boolean;
}): React.ReactElement {
  const { showComments } = props;
  return (
    <>
      <div className="emr-statusbar-control-group emr-statusbar-comment-controls">
        {showCommentStepper ? (
          <CommentStepper
            threadIds={props.commentThreadIds!}
            activeThreadId={props.activeCommentThreadId ?? null}
            onCycle={props.onCycleComment!}
          />
        ) : null}
        <button
          type="button"
          className="emr-statusbar-btn is-toggle"
          aria-pressed={showComments}
          title={showComments ? "Hide comments" : "Show comments"}
          onClick={props.onToggleComments}
        >
          <IconComments />
          <span className="emr-statusbar-btn-label">Comments</span>
        </button>
        <ResolvedPullRequestBadge pullRequest={props.resolvedPullRequest} />
      </div>
      <StatusBarSeparator />
    </>
  );
}

/** The "Aa" reading-preferences popover plus the text-size slider. */
function ReadingPreferencesControls(props: {
  rootRef: React.RefObject<HTMLDivElement>;
  triggerRef: React.RefObject<HTMLButtonElement>;
  popoverRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  onToggleOpen: () => void;
  availableFonts: readonly (typeof READER_FONTS)[number][];
  effectiveFontId: string;
  hasAlternativeFonts: boolean;
  onFontChange: (fontId: string) => void;
  sizePct: number;
  onSizeChange: (sizePct: number) => void;
  spacingPct: number;
  onSpacingChange: (spacingPct: number) => void;
}): React.ReactElement {
  const {
    open,
    hasAlternativeFonts,
    onFontChange,
    spacingPct,
    onSpacingChange,
  } = props;
  return (
    <div className="emr-statusbar-control-group">
      <div
        ref={props.rootRef}
        className={`emr-statusbar-type${open ? " is-open" : ""}`}
      >
        <button
          ref={props.triggerRef}
          type="button"
          className="emr-statusbar-btn"
          aria-haspopup="true"
          aria-expanded={open}
          title="Reading preferences"
          onClick={props.onToggleOpen}
        >
          <span className="emr-statusbar-aa">Aa</span>
          <IconCaret />
        </button>
        <div
          ref={props.popoverRef}
          className="emr-statusbar-pop"
          role="group"
          aria-label="Reading preferences"
          aria-hidden={!open}
        >
          {hasAlternativeFonts ? (
            <>
              <div className="emr-statusbar-pop-label">Reading font</div>
              <div className="emr-statusbar-fontlist">
                {props.availableFonts.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    className={`emr-statusbar-font ${fontClass(font.id)}`}
                    aria-pressed={font.id === props.effectiveFontId}
                    onClick={() => onFontChange(font.id)}
                  >
                    <span>{font.name}</span>
                    <IconCheck />
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div
            className={`emr-statusbar-pop-section${
              hasAlternativeFonts ? "" : " is-only"
            }`}
          >
            <div className="emr-statusbar-pop-label">Text spacing</div>
            <PercentSlider
              label="Text spacing"
              value={spacingPct}
              onChange={onSpacingChange}
              fluid
              min={READER_SPACING_UI_MIN}
              max={READER_SPACING_UI_MAX}
              showDefaultMarker={false}
            />
          </div>
        </div>
      </div>

      <PercentSlider
        label="Text size"
        value={props.sizePct}
        onChange={props.onSizeChange}
      />
    </div>
  );
}

/** Refresh and Feedback controls, after a separator; nothing when neither. */
function RefreshFeedbackControls({
  onRefresh,
  refreshing,
  refreshLabel,
  feedbackHref,
}: Pick<
  ReaderStatusBarProps,
  "onRefresh" | "refreshing" | "refreshLabel" | "feedbackHref"
>): React.ReactElement | null {
  if (!onRefresh && !feedbackHref) return null;
  const label = refreshLabel ?? "Refresh";
  return (
    <>
      <StatusBarSeparator />
      <div className="emr-statusbar-control-group">
        {onRefresh ? (
          <button
            type="button"
            className={`emr-statusbar-btn emr-statusbar-refresh${refreshing ? " is-refreshing" : ""}`}
            onClick={onRefresh}
            disabled={refreshing}
            title={label}
            aria-label={label}
          >
            <IconRefresh />
          </button>
        ) : null}
        {feedbackHref ? (
          <a
            className="emr-statusbar-btn emr-statusbar-feedback"
            href={feedbackHref}
            // The extension runs in a sandboxed ADO iframe, which blocks a
            // same-frame `mailto:` navigation; open in a new browsing context
            // so the OS mail handler launches.
            target="_blank"
            rel="noopener noreferrer"
            title="Share feedback or report a bug"
            aria-label="Share feedback or report a bug"
          >
            <IconFeedback />
          </a>
        ) : null}
      </div>
    </>
  );
}

export function ReaderStatusBar(
  props: ReaderStatusBarProps,
): React.ReactElement {
  const {
    wordCount,
    wordDelta,
    fontId,
    sizePct,
    spacingPct,
    onFontChange,
    onSizeChange,
    onSpacingChange,
    availableFontIds,
    showComments,
    commentsAvailable = true,
    commentThreadIds,
    onCycleComment,
    changesAvailable,
    changesShown,
    iterationOptions,
    iterationRange,
    onIterationRangeChange,
    activities = [],
    activityDelayMs = 250,
  } = props;

  const typeRef = React.useRef<HTMLDivElement>(null);
  const [typeOpen, setTypeOpen] = React.useState(false);
  const {
    triggerRef: typeTriggerRef,
    popoverRef: typePopoverRef,
    restoreFocusAfterClose: restoreTypeFocusAfterClose,
  } = useInertPopover(typeOpen);
  const overriddenFonts = React.useMemo(() => {
    if (!availableFontIds) return undefined;
    const ids = new Set([DEFAULT_FONT_ID, ...availableFontIds]);
    return READER_FONTS.filter((font) => ids.has(font.id));
  }, [availableFontIds]);
  const [detectedFonts, setDetectedFonts] = React.useState<
    readonly (typeof READER_FONTS)[number][]
  >(() => READER_FONTS.filter((font) => !font.localFamily));
  const availableFonts = overriddenFonts ?? detectedFonts;
  const effectiveFontId = availableFonts.some((font) => font.id === fontId)
    ? fontId
    : DEFAULT_FONT_ID;
  const hasAlternativeFonts = availableFonts.some(
    (font) => font.id !== DEFAULT_FONT_ID,
  );

  React.useEffect(() => {
    if (overriddenFonts) return undefined;
    let cancelled = false;
    void detectAvailableReaderFonts(loadLocalReaderFont).then((fonts) => {
      /* v8 ignore next -- defensive unmount guard; no observable UI branch */
      if (cancelled) return;
      setDetectedFonts(fonts);
    });
    return () => {
      cancelled = true;
    };
  }, [overriddenFonts]);

  // Close the font popover on an outside pointer-down or Escape.
  React.useEffect(() => {
    if (!typeOpen) return undefined;
    const onDocPointer = (e: PointerEvent) => {
      if (!typeRef.current!.contains(e.target as Node)) setTypeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      handlePopoverEscape(e, restoreTypeFocusAfterClose, () =>
        setTypeOpen(false),
      );
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [typeOpen, restoreTypeFocusAfterClose]);

  const visibility = statusBarVisibility({
    wordCount,
    wordDelta,
    changesAvailable,
    changesShown,
    commentsAvailable,
    showComments,
    commentThreadIds,
    onCycleComment,
    iterationCount: iterationOptions?.length,
    hasIterationRange: !!iterationRange,
    onIterationRangeChange,
  });
  const selectedActivity = React.useMemo(
    () => selectReaderActivity(activities),
    [activities],
  );
  const visibleActivity = useDelayedReaderActivity(
    selectedActivity,
    activityDelayMs,
  );

  return (
    <div
      className="emr-statusbar"
      role="toolbar"
      aria-label="Reader status and controls"
    >
      <StatusBarLeft props={props} visibility={visibility} />

      <div className="emr-statusbar-center">
        {visibleActivity ? (
          <ReaderActivityIndicator
            activity={visibleActivity}
            activeCount={activities.length}
          />
        ) : null}
      </div>

      <div className="emr-statusbar-controls">
        {commentsAvailable ? (
          <CommentControls
            props={props}
            showCommentStepper={visibility.showCommentStepper}
          />
        ) : null}

        <ReadingPreferencesControls
          rootRef={typeRef}
          triggerRef={typeTriggerRef}
          popoverRef={typePopoverRef}
          open={typeOpen}
          onToggleOpen={() => setTypeOpen((o) => !o)}
          availableFonts={availableFonts}
          effectiveFontId={effectiveFontId}
          hasAlternativeFonts={hasAlternativeFonts}
          onFontChange={onFontChange}
          sizePct={sizePct}
          onSizeChange={onSizeChange}
          spacingPct={spacingPct}
          onSpacingChange={onSpacingChange}
        />

        <RefreshFeedbackControls
          onRefresh={props.onRefresh}
          refreshing={props.refreshing}
          refreshLabel={props.refreshLabel}
          feedbackHref={props.feedbackHref}
        />
      </div>
    </div>
  );
}
