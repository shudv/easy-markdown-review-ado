import { afterEach, describe, expect, it, vi } from "vitest";

import {
    animateBalloonExit,
    exitTiming,
    prefersReducedMotion,
    washOrigin,
} from "../src/shell/components/balloonMotion";

const card = { left: 100, top: 200, width: 300, height: 120 };

describe("washOrigin", () => {
    it("blooms from the press point, reaching the farthest corner", () => {
        expect(washOrigin(card, { x: 130, y: 210 }, null)).toEqual({
            x: 30,
            y: 10,
            radius: Math.hypot(270, 110),
        });
    });

    it("blooms from the focused control when there was no press (keyboard)", () => {
        const focused = { left: 360, top: 210, width: 20, height: 20 };

        expect(washOrigin(card, null, focused)).toMatchObject({ x: 270, y: 20 });
    });

    it("falls back to the card's top-right, where the resolve controls sit", () => {
        expect(washOrigin(card, null, null)).toMatchObject({ x: 268, y: 22 });
    });
});

describe("exitTiming", () => {
    it("fades first and collapses a beat later", () => {
        expect(exitTiming(false)).toEqual({ fadeMs: 220, collapseDelayMs: 150, collapseMs: 320 });
    });

    it("keeps reduced motion to a quick fade and an instant collapse", () => {
        expect(exitTiming(true)).toEqual({ fadeMs: 120, collapseDelayMs: 120, collapseMs: 1 });
    });
});

describe("prefersReducedMotion", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("is false where the media query can't be asked", () => {
        expect(prefersReducedMotion()).toBe(false);
    });

    it("follows the OS setting", () => {
        vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));

        expect(prefersReducedMotion()).toBe(true);
    });
});

describe("animateBalloonExit", () => {
    function fakeAnimate(el: HTMLElement) {
        const calls: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
        const cancel = vi.fn();

        el.animate = ((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
            calls.push({ keyframes, options });

            return { finished: Promise.resolve(), cancel } as unknown as Animation;
        }) as HTMLElement["animate"];

        return { calls, cancel };
    }

    const timing = exitTiming(false);

    it("exits at once where the Web Animations API is missing", async () => {
        const el = document.createElement("div");
        Object.defineProperty(el, "animate", { value: undefined });
        const exit = animateBalloonExit(el, { delayMs: 0, timing });

        // Nothing is running, so cancelling is harmless.
        exit.cancel();

        await expect(exit.finished).resolves.toBeUndefined();
    });

    it("fades, then collapses the slot including the list's gap", async () => {
        const list = document.createElement("div");
        list.style.rowGap = "10px";
        const el = document.createElement("div");
        list.append(el);
        document.body.append(list);
        const { calls, cancel } = fakeAnimate(el);

        const exit = animateBalloonExit(el, { delayMs: 400, timing });
        await exit.finished;
        exit.cancel();

        const [fade, collapse] = calls;
        expect(fade!.options).toMatchObject({ duration: 220, delay: 400 });
        expect(fade!.keyframes[1]).toMatchObject({ opacity: 0 });
        expect(collapse!.options).toMatchObject({ duration: 320, delay: 550 });
        expect(collapse!.keyframes[1]).toMatchObject({ height: "0px", marginBottom: "-10px" });
        expect(cancel).toHaveBeenCalledTimes(2);
        list.remove();
    });

    it("collapses without a gap when the list sets none, or the card is detached", () => {
        const list = document.createElement("div");
        const inList = document.createElement("div");
        list.append(inList);
        document.body.append(list);
        const detached = document.createElement("div");
        const a = fakeAnimate(inList);
        const b = fakeAnimate(detached);

        animateBalloonExit(inList, { delayMs: 0, timing });
        animateBalloonExit(detached, { delayMs: 0, timing });

        expect(a.calls[1]!.keyframes[1]).toMatchObject({ marginBottom: "0px" });
        expect(b.calls[1]!.keyframes[1]).toMatchObject({ marginBottom: "0px" });
        list.remove();
    });
});
