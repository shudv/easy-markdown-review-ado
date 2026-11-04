// ReaderStatusBar — the reader's single, docked control surface. A slim strip
// pinned to the bottom of the reader (Word's status-bar model), spanning the
// full reader width. It replaces the old floating DocToolbar: every reading
// control now lives here.
//
//   left  — document status: word count + the PR word-count delta.
//   right — Navigation · Comments · Changes toggles, an "Aa" reading-font /
//           spacing popover, a text-size slider, Refresh, and Feedback.
//
// All state lives with the host (Shell) and arrives via props; this component
// owns only the transient font-popover open state.

import * as React from "react";

import {
  DEFAULT_FONT_ID,
  detectAvailableReaderFonts,
  READER_FONTS,
} from "../readerPrefs";
import { statusBarVisibility } from "./readerStatusBarModel";
import {
  ReaderActivityIndicator,
  selectReaderActivity,
  useDelayedReaderActivity,
} from "./readerActivity";
import type { ReaderStatusBarProps } from "./ReaderStatusBar.types";
import { useInertPopover, handlePopoverEscape } from "./ReaderStatusBar.hooks";
import {
  StatusBarLeft,
  CommentControls,
  RefreshFeedbackControls,
} from "./ReaderStatusBar.parts";
import { ReadingPreferencesControls } from "./ReadingPreferencesControls";

export type { ReaderIterationOption } from "./ReaderStatusBar.types";

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

// eslint-disable-next-line max-lines-per-function -- Status bar: composes its regions (comparison, comments, reading preferences, refresh) from ReaderStatusBar.parts.
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
