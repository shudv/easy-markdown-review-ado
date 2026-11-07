import { describe, expect, it } from "vitest";

import { FailureStreaks } from "../src/shell/failureStreaks";

describe("FailureStreaks", () => {
    it("reports the first failure of a streak and stays quiet for the rest", () => {
        const streaks = new FailureStreaks();
        expect(streaks.fail("work-item-search")).toBe(true);
        expect(streaks.fail("work-item-search")).toBe(false);
        expect(streaks.fail("work-item-search")).toBe(false);
    });

    it("starts a new streak after a success", () => {
        const streaks = new FailureStreaks();
        streaks.fail("work-item-search");
        streaks.succeed("work-item-search");
        expect(streaks.fail("work-item-search")).toBe(true);
    });

    it("tracks each operation separately", () => {
        const streaks = new FailureStreaks();
        streaks.fail("work-item-search");
        expect(streaks.fail("user-search")).toBe(true);
        streaks.succeed("user-search");
        expect(streaks.fail("work-item-search")).toBe(false);
    });
});
