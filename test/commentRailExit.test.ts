import { describe, expect, it } from "vitest";

import { nextExiting } from "../src/shell/components/CommentRail.exit";

const set = (...ids: string[]) => new Set(ids);

describe("nextExiting", () => {
    it("starts the exit of a thread that was visible and is now hidden", () => {
        const next = nextExiting({
            exiting: set(),
            prevHidden: set(),
            hidden: set("t2"),
            before: set("t1", "t2"),
            now: set("t1", "t2"),
        });

        expect([...next]).toEqual(["t2"]);
    });

    it("doesn't animate a thread that arrived already hidden (another file's)", () => {
        const next = nextExiting({
            exiting: set(),
            prevHidden: set(),
            hidden: set("other"),
            before: set("t1"),
            now: set("other"),
        });

        expect(next.size).toBe(0);
    });

    it("keeps a thread leaving while it stays hidden", () => {
        const next = nextExiting({
            exiting: set("t2"),
            prevHidden: set("t2"),
            hidden: set("t2", "t3"),
            before: set("t2"),
            now: set("t2", "t3"),
        });

        expect([...next]).toEqual(["t2"]);
    });

    it("stops the exit when the thread is shown again or deleted", () => {
        const shownAgain = nextExiting({
            exiting: set("t2"),
            prevHidden: set("t2"),
            hidden: set(),
            before: set("t2"),
            now: set("t2"),
        });

        const deleted = nextExiting({
            exiting: set("t2"),
            prevHidden: set("t2"),
            hidden: set("t2"),
            before: set("t2"),
            now: set(),
        });

        expect(shownAgain.size).toBe(0);
        expect(deleted.size).toBe(0);
    });
});
