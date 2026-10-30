// PrShell: scrolling the document to threads, headings and quoted text.

import * as React from "react";

import {
  ANCHOR_TARGET_CUE_MS,
  currentTextCue,
  findAnchorTarget,
  flashAnchorTarget,
  flashTextTarget,
  holdScrollOnTarget,
  revealAnchorTarget,
} from "../headingAnchors";
import { findTextFragment, parseTextFragment } from "../textFragment";

export type ScrollDocToHash = (
  hash: string,
  opts?: {
    hold?: boolean;
    focus?: boolean;
    onResolved?: (found: boolean) => void;
  },
) => void;

export type ScrollDocToText = (
  serialized: string,
  onResolved: (found: boolean) => void,
) => void;

/**
 * Document scrolling: to a thread's highlight, a heading anchor, or a quoted
 * text fragment. `activeStorageKeyRef` must be kept pointed at the article's
 * storage key (collapsed-section state) by the caller.
 */
export function useDocScroll(initialStorageKey: string): {
  scrollDocToAnchor: (tid: string) => void;
  scrollDocToHash: ScrollDocToHash;
  scrollDocToText: ScrollDocToText;
  activeStorageKeyRef: React.MutableRefObject<string>;
} {
  // Scroll the DOCUMENT so a thread's anchored highlight is centred in view.
  // (The rail-follow effect scrolls the rail to the balloon separately.)
  const scrollDocToAnchor = React.useCallback((tid: string) => {
    window.requestAnimationFrame(() => {
      /* v8 ignore next -- scrollIntoView is inert in headless tests */
      document
        .querySelector(`.markdown-body [data-thread-id="${CSS.escape(tid)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // Scroll the document to an anchor target (a heading slug from an `#anchor`
  // link or an `?anchor=` deep link). Resolves foreign slug styles, unfolds
  // any collapsed section hiding the target, and replays the landing cue.
  // `hold` keeps the target aligned while late content (diff decorations,
  // highlights, diagrams, images) settles — used whenever the document was
  // just opened, where that async layout would otherwise push it off-screen.
  // Returns via rAF so the just-committed article is queryable.
  const activeStorageKeyRef = React.useRef(initialStorageKey);
  const releaseScrollHoldRef = React.useRef<(() => void) | null>(null);
  const stopLandingCueRef = React.useRef<(() => void) | null>(null);
  React.useEffect(
    () => () => {
      releaseScrollHoldRef.current?.();
      stopLandingCueRef.current?.();
    },
    [],
  );
  const scrollDocToHash = React.useCallback<ScrollDocToHash>((hash, opts) => {
    if (!hash) return;
    window.requestAnimationFrame(() => {
      const article = document.querySelector<HTMLElement>(
        ".emr-article-wrap > .emr-rendered",
      );
      /* v8 ignore next -- the article is mounted whenever a document has rendered */
      if (!article) return;
      const target = findAnchorTarget(article, hash);
      opts?.onResolved?.(target !== null);
      if (!target) return;
      revealAnchorTarget(target, activeStorageKeyRef.current);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // The article element persists across re-wraps (only its children are
      // replaced), so the landing cue and the scroll hold re-resolve the
      // target inside it each time.
      const resolveTarget = () => findAnchorTarget(article, hash);
      stopLandingCueRef.current?.();
      stopLandingCueRef.current = flashAnchorTarget(article, resolveTarget);
      // A link the user followed moves focus to its target, as native
      // fragment navigation does, so the next Tab and screen readers continue
      // from there. (Not for a mount-time deep link: that would steal focus
      // from the host page.)
      if (opts?.focus) {
        if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      releaseScrollHoldRef.current?.();
      releaseScrollHoldRef.current = opts?.hold
        ? holdScrollOnTarget(article, resolveTarget)
        : null;
    });
  }, []);

  // Scroll to and flash the text a `?text=` deep link quotes: unfold any
  // collapsed section hiding it, centre it, play the heading's landing cue on
  // the words themselves, and hold it in view while late content settles.
  // `onResolved` reports whether the text was found (the caller then falls
  // back to the section heading).
  const scrollDocToText = React.useCallback<ScrollDocToText>(
    (serialized, onResolved) => {
      window.requestAnimationFrame(() => {
        const article = document.querySelector<HTMLElement>(
          ".emr-article-wrap > .emr-rendered",
        );
        /* v8 ignore next -- the article is mounted whenever a document has rendered */
        if (!article) return;
        const fragment = parseTextFragment(serialized);
        const range = fragment ? findTextFragment(article, fragment) : null;
        onResolved(range !== null);
        if (!fragment || !range) return;
        revealAnchorTarget(
          range.startContainer.parentElement!,
          activeStorageKeyRef.current,
        );
        const resolveRange = () => findTextFragment(article, fragment);
        stopLandingCueRef.current?.();
        stopLandingCueRef.current = flashTextTarget(article, resolveRange);
        // The cue's first span is the scroll target; the hold lasts as long
        // as the cue (it re-finds the span after each re-wrap).
        const resolveTarget = () => currentTextCue(article);
        resolveTarget()?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        releaseScrollHoldRef.current?.();
        releaseScrollHoldRef.current = holdScrollOnTarget(
          article,
          resolveTarget,
          ANCHOR_TARGET_CUE_MS,
          "center",
        );
      });
    },
    [],
  );

  return {
    scrollDocToAnchor,
    scrollDocToHash,
    scrollDocToText,
    activeStorageKeyRef,
  };
}
