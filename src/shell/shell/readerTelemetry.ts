// Shell: engagement telemetry for reader controls that report through a plain
// callback (the presentational components stay telemetry-free).

import { events, track } from "../../telemetry";
import type { ReviewIterationRange } from "../shellHelpers";

/** Report the change minimap being clicked or dragged. */
export function trackMinimapUse(via: "click" | "drag"): void {
    track(events.minimapUsed({ via }));
}

/** How much of the PR a comparison spans: every update, one, or several. */
export function comparisonScope(
    range: ReviewIterationRange,
    updateCount: number,
): "all" | "single" | "range" {
    if (range.fromUpdate === 0 && range.toUpdate >= Math.max(1, updateCount)) return "all";

    return range.toUpdate - range.fromUpdate === 1 ? "single" : "range";
}
