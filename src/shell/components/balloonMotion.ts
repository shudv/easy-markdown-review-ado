// Motion for a thread balloon's resolve moment and its exit from the rail.
//
//   * Resolve: a soft green wash blooms from where the user resolved (the press
//     point, or the focused control for keyboard users) and recedes.
//   * Exit: when a filter hides a thread that was on screen, the card fades and
//     lifts slightly, then its slot collapses so the cards below glide up.
//
// The geometry and timing are pure functions; `animateBalloonExit` is the only
// DOM-touching piece, and degrades to an instant exit where the Web Animations
// API isn't available.

/** How long the resolve wash (and its border pulse) plays, in ms. */
export const RESOLVE_WASH_MS = 1000;

interface Point {
    x: number;
    y: number;
}

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Wash origin within the card, and the radius that reaches its far corner. */
export interface WashOrigin {
    x: number;
    y: number;
    radius: number;
}

/**
 * Where the wash blooms from, relative to the card: the press point when the
 * user clicked, else the centre of the focused control (keyboard), else near
 * the card's top-right, where the resolve controls sit.
 */
export function washOrigin(card: Box, press: Point | null, focused: Box | null): WashOrigin {
    let x = card.width - 32;
    let y = 22;

    if (press) {
        x = press.x - card.left;
        y = press.y - card.top;
    } else if (focused) {
        x = focused.left + focused.width / 2 - card.left;
        y = focused.top + focused.height / 2 - card.top;
    }

    const radius = Math.hypot(Math.max(x, card.width - x), Math.max(y, card.height - y));

    return { x, y, radius };
}

/** Exit choreography: fade first, then the slot collapses a beat later. */
export interface ExitTiming {
    fadeMs: number;
    collapseDelayMs: number;
    collapseMs: number;
}

/** Exit timing, shortened to a quick fade and an instant collapse for reduced motion. */
export function exitTiming(reducedMotion: boolean): ExitTiming {
    return reducedMotion
        ? { fadeMs: 120, collapseDelayMs: 120, collapseMs: 1 }
        : { fadeMs: 220, collapseDelayMs: 150, collapseMs: 320 };
}

/** Whether the user asked the OS for reduced motion (false where it can't be queried). */
export function prefersReducedMotion(): boolean {
    return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/** A running exit: resolves when the card is gone, or can be cancelled. */
export interface BalloonExit {
    finished: Promise<void>;
    cancel: () => void;
}

/**
 * Fade the card out, then collapse its slot (height, padding, border and the
 * list's gap) so the cards below glide up into its place. The caller unmounts
 * the card once `finished` resolves.
 */
export function animateBalloonExit(
    el: HTMLElement,
    opts: Readonly<{ delayMs: number; timing: ExitTiming }>,
): BalloonExit {
    if (typeof el.animate !== "function") return { finished: Promise.resolve(), cancel: () => {} };

    const { delayMs, timing } = opts;
    const style = getComputedStyle(el);
    const gap = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).rowGap) : 0;
    const fill = "forwards";

    const fade = el.animate(
        [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateY(-4px) scale(0.985)" },
        ],
        { duration: timing.fadeMs, delay: delayMs, easing: "cubic-bezier(0.4, 0, 1, 1)", fill },
    );

    const collapse = el.animate(
        [
            {
                boxSizing: "border-box",
                overflow: "hidden",
                height: `${el.offsetHeight}px`,
                paddingTop: style.paddingTop,
                paddingBottom: style.paddingBottom,
                borderTopWidth: style.borderTopWidth,
                borderBottomWidth: style.borderBottomWidth,
                marginBottom: "0px",
            },
            {
                boxSizing: "border-box",
                overflow: "hidden",
                height: "0px",
                paddingTop: "0px",
                paddingBottom: "0px",
                borderTopWidth: "0px",
                borderBottomWidth: "0px",
                // Cancels the list's flex gap, so nothing jumps when it unmounts.
                marginBottom: `${-(Number.isFinite(gap) ? gap : 0)}px`,
            },
        ],
        {
            duration: timing.collapseMs,
            delay: delayMs + timing.collapseDelayMs,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill,
        },
    );

    return {
        finished: Promise.all([fade.finished, collapse.finished]).then(() => undefined),
        cancel: () => {
            fade.cancel();
            collapse.cancel();
        },
    };
}
