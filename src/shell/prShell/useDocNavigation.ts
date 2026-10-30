// PrShell: opening documents and scrolling to their pending deep-link target.

import * as React from "react";

import type { FileInfo } from "../../types";
import {
  resolveDocLink,
  routeDocLink,
  samePath,
} from "../../markdown/docLinks";
import { events, track } from "../../telemetry";
import type { ScrollDocToHash, ScrollDocToText } from "./useDocScroll";
import type { DocLinkNavigation } from "./types";

type MissingDocOutcome = "replaced" | "expected" | "unexpected";

interface DocNavigationOptions {
  initialActiveThreadId: string | undefined;
  initialAnchor: string | undefined;
  initialTextFragment: string | undefined;
  documentsMode: boolean | undefined;
  files: FileInfo[];
  selectedPath: string;
  isHub: boolean;
  missingDoc: { missing: string; shown: string } | null;
  onSelectPath: ((path: string) => void) | undefined;
  onDocNavigate: ((target: DocLinkNavigation) => void) | undefined;
  setSelectedPath: (path: string) => void;
  setActiveThreadId: (threadId: string | null) => void;
  setMissingDoc: (doc: { missing: string; shown: string } | null) => void;
  setLoading: (loading: boolean) => void;
  dismissEmptyDraftRef: React.MutableRefObject<() => void>;
  handleMissingDocRef: React.MutableRefObject<
    (missing: string) => MissingDocOutcome
  >;
  scrollDocToHash: ScrollDocToHash;
}

/**
 * Opening documents in this reader — from the nav, an in-document link, or a
 * missing document's replacement — plus the heading/text a just-opened
 * document should scroll to once it renders.
 */
export function useDocNavigation(opts: DocNavigationOptions) {
  const {
    onSelectPath,
    onDocNavigate,
    files,
    selectedPath,
    isHub,
    setSelectedPath,
    setActiveThreadId,
    setMissingDoc,
    setLoading,
    dismissEmptyDraftRef,
    scrollDocToHash,
  } = opts;
  // Heading to scroll to once the selected document renders: a cross-document
  // `#anchor` link, or the `?anchor=` deep link seeded at mount (a `?comment=`
  // link wins when both are present — the thread's own scroll would fight the
  // heading's).
  const pendingScrollHashRef = React.useRef<string | null>(
    opts.initialActiveThreadId ? null : (opts.initialAnchor ?? null),
  );
  const pendingHashIsDeepLinkRef = React.useRef(
    pendingScrollHashRef.current !== null,
  );
  // Text to flash once the selected document renders (the `?text=` deep link
  // seeded at mount); the heading above is its fallback.
  const pendingTextRef = React.useRef<string | null>(
    opts.initialActiveThreadId ? null : (opts.initialTextFragment ?? null),
  );

  // Open a document in THIS reader (shared by the nav and in-document link
  // clicks): select it, drop the active thread, tear down an empty draft, and
  // report the change up so the host can reflect it in the route. A deep-link
  // heading still waiting on the previous document no longer applies.
  const selectDocPath = React.useCallback(
    (path: string) => {
      pendingScrollHashRef.current = null;
      pendingHashIsDeepLinkRef.current = false;
      pendingTextRef.current = null;
      setMissingDoc(null);
      setSelectedPath(path);
      setActiveThreadId(null);
      dismissEmptyDraftRef.current();
      track(events.fileOpened({ source: "nav-click" }));
      onSelectPath?.(path);
    },
    [
      onSelectPath,
      setMissingDoc,
      setSelectedPath,
      setActiveThreadId,
      dismissEmptyDraftRef,
    ],
  );

  // A document that no longer exists (a stale `?path=` link or the hub's
  // remembered last document after a rename/delete). In the Documents hub this
  // is an expected state, not a failure: open the repo's first other document
  // instead — reporting it up so the route and the remembered path move on —
  // and say what happened. Elsewhere (the PR tab) it stays an error.
  opts.handleMissingDocRef.current = (missing) => {
    if (!opts.documentsMode) return "unexpected";
    // Fall back once: if the replacement is missing too, stop there rather
    // than bouncing between missing documents.
    if (opts.missingDoc?.shown === missing) return "expected";
    const next = files.find((f) => f.path !== missing)?.path;
    if (!next) return "expected";
    // A deep-link heading/text targeted the missing document; drop it.
    pendingScrollHashRef.current = null;
    pendingHashIsDeepLinkRef.current = false;
    pendingTextRef.current = null;
    setMissingDoc({ missing, shown: next });
    setLoading(false);
    setSelectedPath(next);
    onSelectPath?.(next);
    return "replaced";
  };

  // A relative in-document link was clicked. Resolve it against the open file
  // and route it (see `routeDocLink`): scroll (in-page / self), select in place
  // (a PR file, or anywhere in the hub), open the Documents hub (Markdown
  // outside the PR), or hand a non-Markdown file to ADO's native Files view.
  // Returns true when consumed; external links return false and fall through.
  const handleDocLink = React.useCallback(
    (href: string): boolean => {
      const action = routeDocLink(resolveDocLink(selectedPath, href), {
        isHub,
        currentPath: selectedPath,
        isInReader: (p) => files.some((f) => samePath(f.path, p)),
      });
      if (action.type === "external") return false;
      if (action.type === "scroll") {
        scrollDocToHash(action.hash, { focus: true });
      } else if (action.type === "select") {
        selectDocPath(action.path);
        // Scroll to the linked heading once the new document has rendered.
        pendingScrollHashRef.current = action.hash || null;
        pendingHashIsDeepLinkRef.current = false;
      } else if (action.type === "open-file") {
        /* v8 ignore next -- onDocNavigate is optional; embeds without host nav omit it */
        onDocNavigate?.({ kind: "repo-file", path: action.path });
      } else {
        /* v8 ignore next -- onDocNavigate is optional; embeds without host nav omit it */
        onDocNavigate?.({
          kind: "hub-doc",
          path: action.path,
          hash: action.hash,
        });
      }
      return true;
    },
    [selectedPath, isHub, files, onDocNavigate, selectDocPath, scrollDocToHash],
  );

  return {
    selectDocPath,
    handleDocLink,
    pendingScrollHashRef,
    pendingHashIsDeepLinkRef,
    pendingTextRef,
  };
}

interface PendingDocScrollOptions {
  articleReady: boolean;
  selectedPath: string;
  activePristineHtml: string;
  pendingScrollHashRef: React.MutableRefObject<string | null>;
  pendingHashIsDeepLinkRef: React.MutableRefObject<boolean>;
  pendingTextRef: React.MutableRefObject<string | null>;
  scrollDocToHash: ScrollDocToHash;
  scrollDocToText: ScrollDocToText;
}

/**
 * Cross-document `#anchor`: once the newly selected doc has rendered, scroll
 * to its heading (a same-doc anchor scrolls immediately in handleDocLink).
 * Also consumes the `?anchor=` / `?text=` deep links seeded at mount.
 */
export function usePendingDocScroll(opts: PendingDocScrollOptions): void {
  const {
    articleReady,
    selectedPath,
    activePristineHtml,
    pendingScrollHashRef,
    pendingHashIsDeepLinkRef,
    pendingTextRef,
    scrollDocToHash,
    scrollDocToText,
  } = opts;
  React.useEffect(() => {
    if (!articleReady) return;
    const text = pendingTextRef.current;
    if (text) {
      pendingTextRef.current = null;
      const fallback = pendingScrollHashRef.current;
      pendingScrollHashRef.current = null;
      pendingHashIsDeepLinkRef.current = false;
      scrollDocToText(text, (found) => {
        track(events.linkOpened({ target: "text", found }));
        if (!found && fallback) scrollDocToHash(fallback, { hold: true });
      });
      return;
    }
    const hash = pendingScrollHashRef.current;
    if (!hash) return;
    pendingScrollHashRef.current = null;
    const fromDeepLink = pendingHashIsDeepLinkRef.current;
    pendingHashIsDeepLinkRef.current = false;
    scrollDocToHash(hash, {
      hold: true,
      focus: !fromDeepLink,
      onResolved: fromDeepLink
        ? (found) => track(events.linkOpened({ target: "heading", found }))
        : undefined,
    });
  }, [
    selectedPath,
    articleReady,
    activePristineHtml,
    scrollDocToHash,
    scrollDocToText,
    pendingScrollHashRef,
    pendingHashIsDeepLinkRef,
    pendingTextRef,
  ]);
}
