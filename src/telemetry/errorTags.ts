// Diagnostic properties attached to a thrown value where it is classified, and
// carried onto its `app.exception` row wherever it is eventually reported.
//
// The module that understands a failure (e.g. the dead-window check, which
// re-reads the host token after a 401) is rarely the one that reports it (a
// poller, a write path, a boot screen). Tagging the error object lets the
// classifier's findings reach the row without threading them through every
// caller. Tags pass the same sanitizer as any other property, and properties
// given at the report site win over tags.

import type { TelemetryProperties } from "./types";

const tags = new WeakMap<object, TelemetryProperties>();

/** Attach (merge) diagnostic properties to `error`. Primitives can't be tagged. */
export function tagError(error: unknown, props: TelemetryProperties): void {
    if (typeof error !== "object" || error === null) return;
    tags.set(error, { ...tags.get(error), ...props });
}

/** Properties previously attached to `error` with {@link tagError}, if any. */
export function errorTagsOf(error: unknown): TelemetryProperties | undefined {
    return typeof error === "object" && error !== null ? tags.get(error) : undefined;
}
