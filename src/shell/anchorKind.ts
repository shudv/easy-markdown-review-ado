import type { AnchorKind } from "../telemetry";
import type { TextQuoteAnchor } from "../types";

/** Classify an anchor for telemetry without revealing the anchored text. */
export function anchorKindOf(anchor: TextQuoteAnchor): AnchorKind {
    // Stryker disable next-line LogicalOperator,ConditionalExpression,EqualityOperator: `exact` is always a string, so its truthiness and `length > 0` agree and either check alone decides the kind
    if (anchor.exact && anchor.exact.length > 0) return "text-quote";
    if (anchor.line !== undefined) return "line";

    return "file-level";
}
