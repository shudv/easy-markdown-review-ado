import { describe, it, expect } from "vitest";
import { isResolvedLike, type ThreadStatus } from "../src/types";

describe("isResolvedLike", () => {
    // Resolved-like threads are hidden and counted together; the rest stay open.
    it.each([
        ["resolved", true],
        ["wontFix", true],
        ["closed", true],
        ["active", false],
        ["pending", false],
    ] satisfies Array<[ThreadStatus, boolean]>)(
        "treats a %s thread as resolved-like: %s",
        (status, resolvedLike) => {
            expect(isResolvedLike(status)).toBe(resolvedLike);
        },
    );
});
