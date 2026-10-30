// Pure derivations for the Balloon (thread card): its class list, positioning
// style, and status-chip label.

import type * as React from "react";
import type { ThreadStatus } from "../../types";

/** Status a balloon displays; orphaned cards override the thread status. */
export type BalloonDisplayStatus = ThreadStatus | "orphaned";

const STATUS_LABELS: Record<BalloonDisplayStatus, string> = {
  active: "Active",
  resolved: "Resolved",
  wontFix: "Won't fix",
  closed: "Closed",
  pending: "Pending",
  orphaned: "Anchor missing",
};

export function balloonStatusLabel(status: BalloonDisplayStatus): string {
  return STATUS_LABELS[status];
}

export function balloonClassName(flags: {
  inline?: boolean;
  isActive: boolean;
  resolved: boolean;
  isOrphaned?: boolean;
  general?: boolean;
}): string {
  const classes = ["emr-balloon"];
  if (flags.inline) classes.push("inline");
  if (flags.isActive) classes.push("is-active");
  if (flags.resolved) classes.push("is-resolved");
  if (flags.isOrphaned) classes.push("is-orphaned");
  if (flags.general) classes.push("is-general");
  return classes.join(" ");
}

/** Inline balloons flow naturally; positioned ones sit at `topPx` (or 0). */
export function balloonStyle(
  inline: boolean | undefined,
  topPx: number | undefined,
): React.CSSProperties {
  return inline ? {} : { top: typeof topPx === "number" ? topPx : 0 };
}
