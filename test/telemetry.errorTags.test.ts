// Tests for error tags: diagnostic properties attached to a thrown value where
// it is classified and carried onto its `app.exception` row when reported.

import { describe, expect, it } from "vitest";

import { errorTagsOf, tagError } from "../src/telemetry/errorTags";
import { trackUserFacingError } from "../src/telemetry/telemetry";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

describe("tagError / errorTagsOf", () => {
    it("merges successive tags on the same error", () => {
        const err = new Error("boom");
        tagError(err, { grantState: "live", grantRead: "ok" });
        tagError(err, { grantRead: "failed" });
        expect(errorTagsOf(err)).toEqual({ grantState: "live", grantRead: "failed" });
    });

    it("ignores values that can't carry tags", () => {
        tagError("boom", { grantState: "live" });
        tagError(null, { grantState: "live" });
        expect(errorTagsOf("boom")).toBeUndefined();
        expect(errorTagsOf(null)).toBeUndefined();
        expect(errorTagsOf({})).toBeUndefined();
    });
});

describe("trackException with tags", () => {
    it("adds the error's tags to its row, sanitized, with report-site properties winning", () => {
        const err = { status: 401 };
        tagError(err, {
            grantState: "live",
            secsUntilExp: 900,
            operation: "from-tag",
            userEmail: "someone",
        });
        trackUserFacingError({
            error: err,
            source: "ThreadSync.poll",
            operation: "comments-refresh",
            impact: "degraded",
        });

        expect(telemetry.current.exceptions[0]!.properties).toEqual({
            grantState: "live",
            secsUntilExp: 900,
            operation: "comments-refresh",
            impact: "degraded",
        });
    });
});
