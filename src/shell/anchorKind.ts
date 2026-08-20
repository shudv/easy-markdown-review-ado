import type { AnchorKind } from "../telemetry";
import type { TextQuoteAnchor } from "../types";

/** Classify an anchor for telemetry without revealing the anchored text. */
export function anchorKindOf(anchor: TextQuoteAnchor): AnchorKind {
  if (anchor.exact && anchor.exact.length > 0) return "text-quote";
  if (anchor.line !== undefined) return "line";
  return "file-level";
}
