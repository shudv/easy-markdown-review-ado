// Status-bar picker for comparing pull-request updates.

import * as React from "react";

import {
  allReviewIterations,
  betweenReviewUpdates,
  oneReviewUpdate,
  resolveReviewIterationRange,
  type ReviewIterationRange,
} from "../prShellHelpers";
import {
  baseCommitTitle,
  iterationOptionClassName,
  iterationPickerModel,
} from "./readerStatusBarModel";
import type { ReaderIterationOption } from "./ReaderStatusBar.types";
import { IconChevron } from "./ReaderStatusBar.icons";
import { useInertPopover, handlePopoverEscape } from "./ReaderStatusBar.hooks";

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

// eslint-disable-next-line max-lines-per-function -- PR update picker: update listbox, comparison range and keyboard handling share selection state and one ARIA listbox.
export function IterationPicker({
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
    /* v8 ignore next -- resolveReviewIterationRange clamps toUpdate into 1..updateCount, so either the All updates row or the toUpdate row is always aria-selected */
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
