// Resolve and exit motion for one Balloon (see balloonMotion.ts for the
// choreography). Kept out of Balloon.tsx so the card stays a renderer.

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
    animateBalloonExit,
    exitTiming,
    prefersReducedMotion,
    RESOLVE_WASH_MS,
    washOrigin,
    type WashOrigin,
} from "./balloonMotion";

/** A playing resolve wash; `id` restarts the animation for a repeat resolve. */
export interface Wash extends WashOrigin {
    id: number;
}

/** A press older than this didn't trigger the resolve (keyboard or menu use). */
const PRESS_WINDOW_MS = 1000;

export function useResolveMotion(
    opts: Readonly<{
        ref: RefObject<HTMLDivElement | null>;
        threadId: string;
        /** The thread is being hidden: play the exit, then call `onExited`. */
        exiting: boolean;
        onExited?: (threadId: string) => void;
    }>,
): {
    wash: Wash | null;
    startWash: () => void;
    notePress: (e: Readonly<{ clientX: number; clientY: number }>) => void;
} {
    const { ref, threadId, exiting, onExited } = opts;
    const press = useRef<{ x: number; y: number; at: number } | null>(null);
    const washEndsAt = useRef(0);
    // Latest callback, so a parent passing a fresh function each render can't
    // restart an exit that is already playing.
    const exitedRef = useRef(onExited);

    useEffect(() => {
        exitedRef.current = onExited;
    }, [onExited]);
    const [wash, setWash] = useState<Wash | null>(null);

    const notePress = useCallback((e: Readonly<{ clientX: number; clientY: number }>) => {
        press.current = { x: e.clientX, y: e.clientY, at: performance.now() };
    }, []);

    const startWash = useCallback(() => {
        const el = ref.current;
        /* v8 ignore next -- resolve controls live inside the card, so it is always mounted when one is used */
        if (el === null) return;

        const now = performance.now();

        const recent =
            press.current !== null && now - press.current.at < PRESS_WINDOW_MS
                ? press.current
                : null;

        const active = document.activeElement;

        const focused =
            active instanceof HTMLElement && active !== el && el.contains(active)
                ? active.getBoundingClientRect()
                : null;

        press.current = null;
        washEndsAt.current = now + RESOLVE_WASH_MS;
        setWash({ ...washOrigin(el.getBoundingClientRect(), recent, focused), id: now });
    }, [ref]);

    useEffect(() => {
        if (wash === null) return;

        const timer = window.setTimeout(() => setWash(null), RESOLVE_WASH_MS);

        return () => window.clearTimeout(timer);
    }, [wash]);

    useEffect(() => {
        const el = ref.current;
        if (!exiting || el === null) return;

        // A thread resolved here finishes its wash before it leaves.
        const delayMs = Math.max(0, washEndsAt.current - performance.now());

        const exit = animateBalloonExit(el, {
            delayMs,
            timing: exitTiming(prefersReducedMotion()),
        });

        void exit.finished.then(
            () => exitedRef.current?.(threadId),
            // Cancelled because the thread came back into view: nothing to do.
            () => {},
        );

        return () => exit.cancel();
    }, [exiting, ref, threadId]);

    return { wash, startWash, notePress };
}
