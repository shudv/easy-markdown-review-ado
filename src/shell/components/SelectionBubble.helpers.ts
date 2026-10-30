// Pure derivations for the SelectionBubble's "Copy link to selection" control.

/** How long the copy outcome stays visible before the bubble closes. */
export const LINK_RESULT_MS = { copied: 1200, failed: 2400 } as const;

export type SelectionLinkState =
  | "idle"
  | "pending"
  | keyof typeof LINK_RESULT_MS;

/** The visible/announced copy outcome, or null while idle / pending. */
export function selectionLinkResultLabel(
  state: SelectionLinkState,
): string | null {
  if (state === "copied") return "Link copied";
  if (state === "failed") return "Couldn't copy link";
  return null;
}

/** Class list for the link button, flagging the copy outcome. */
export function selectionLinkButtonClass(state: SelectionLinkState): string {
  return [
    "emr-selection-bubble-link",
    state === "copied" ? "is-copied" : "",
    state === "failed" ? "is-failed" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
