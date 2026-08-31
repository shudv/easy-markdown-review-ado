import React, { useEffect, useRef, useState, type ReactElement } from "react";
import type { ReaderActivity } from "../prShellHelpers";

export type { ReaderActivity } from "../prShellHelpers";

/** Highest priority wins; later entries win ties as the newest activity. */
export function selectReaderActivity(
  activities: readonly ReaderActivity[],
): ReaderActivity | null {
  let selected: ReaderActivity | null = null;
  for (const activity of activities) {
    if (!selected || activity.priority >= selected.priority) {
      selected = activity;
    }
  }
  return selected;
}

export function readerActivityKey(activity: ReaderActivity | null): string {
  return activity
    ? `${activity.id}\u0000${activity.label}\u0000${activity.priority}`
    : "";
}

/** Delay transient work so fast operations do not flash in the status bar. */
export function useDelayedReaderActivity(
  activity: ReaderActivity | null,
  delayMs: number,
): ReaderActivity | null {
  const [visible, setVisible] = useState<ReaderActivity | null>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const activityKey = readerActivityKey(activity);

  useEffect(() => {
    setVisible(null);
    if (!activityRef.current) return undefined;
    const timeout = window.setTimeout(
      () => setVisible(activityRef.current),
      delayMs,
    );
    return () => window.clearTimeout(timeout);
  }, [activityKey, delayMs]);

  return visible;
}

export function ReaderActivityIndicator({
  activity,
  activeCount = 1,
}: {
  activity: ReaderActivity;
  activeCount?: number;
}): ReactElement {
  const title =
    activeCount > 1
      ? `${activity.label} (${activeCount} operations running)`
      : activity.label;
  return (
    <div
      className="emr-statusbar-activity"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={title}
    >
      <span className="emr-statusbar-spinner" aria-hidden="true" />
      <span className="emr-statusbar-activity-label">{activity.label}</span>
    </div>
  );
}
