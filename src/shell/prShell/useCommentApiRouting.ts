// PrShell: comment API, routed-PR pill and identity store per document.

import * as React from "react";

import { LocalOnlyCommentApi, type CommentApi } from "../../comments/api";
import {
  IdentityStore,
  type IdentityResolver,
} from "../../comments/identityStore";
import type { RoutedPrInfo } from "./types";

interface CommentApiRoutingOptions {
  commentApi: CommentApi | undefined;
  commentApiForPath: ((path: string) => CommentApi | undefined) | undefined;
  routedPr: RoutedPrInfo | null | undefined;
  routedPrForPath:
    | ((path: string) => RoutedPrInfo | null | undefined)
    | undefined;
  selectedPath: string;
}

/**
 * Resolves the CommentApi, routed-PR pill and shared identity store the shell
 * uses for the selected document.
 */
export function useCommentApiRouting(opts: CommentApiRoutingOptions): {
  identityStore: IdentityStore;
  commentApi: CommentApi;
  perDocNoWriteTarget: boolean;
  routedPrResolution: RoutedPrInfo | null | undefined;
  effectiveRoutedPr: RoutedPrInfo | undefined;
} {
  const { commentApiForPath, routedPr, routedPrForPath, selectedPath } = opts;
  // Stable CommentApi: callers supply one (real ADO) or we fall back to a
  // session-local stub so standalone dev still works.
  const commentApiRef = React.useRef<CommentApi | null>(null);
  if (commentApiRef.current === null) {
    commentApiRef.current = opts.commentApi ?? new LocalOnlyCommentApi();
    /* v8 ignore start -- only when a caller swaps the CommentApi instance after mount */
  } else if (opts.commentApi && opts.commentApi !== commentApiRef.current) {
    commentApiRef.current = opts.commentApi;
  }
  /* v8 ignore stop */
  // Per-document routing cache (Documents hub "transparent PR" mode). The
  // effective `commentApi` is resolved from `selectedPath` further below.
  const perPathApiCacheRef = React.useRef<Map<string, CommentApi>>(new Map());

  // Shared identity store: one GUID→name cache reused by every rendered comment
  // so `@<GUID>` user mentions resolve consistently (ADO-style). The resolver
  // reads the latest effective CommentApi via a ref so a per-document API swap
  // still resolves; the store is created once and provided to the subtree.
  const resolveIdentitiesRef = React.useRef<IdentityResolver | undefined>(
    undefined,
  );
  const identityStoreRef = React.useRef<IdentityStore | null>(null);
  if (identityStoreRef.current === null) {
    identityStoreRef.current = new IdentityStore(
      (ids) =>
        /* v8 ignore start -- resolver is always wired before IdentityStore first fetches */
        resolveIdentitiesRef.current
          ? resolveIdentitiesRef.current(ids)
          : Promise.resolve({}),
      /* v8 ignore stop */
    );
  }
  const identityStore = identityStoreRef.current;

  // Effective CommentApi. In per-document mode it's resolved (and cached) from
  // the selected file so each document writes to its own housing PR; otherwise
  // it's the single stable instance from props / the local fallback.
  const { commentApi, perDocNoWriteTarget } = React.useMemo<{
    commentApi: CommentApi;
    perDocNoWriteTarget: boolean;
  }>(() => {
    if (commentApiForPath) {
      const cache = perPathApiCacheRef.current;
      let api = cache.get(selectedPath);
      if (!api) {
        // A document whose housing PR isn't resolved yet — or has none —
        // resolves to `undefined`; don't cache the fallback.
        api = commentApiForPath(selectedPath);
        if (api) cache.set(selectedPath, api);
      }
      // No routed PR to persist to: still render via the session-local stub,
      // but flag the document as having no write target so the composer is
      // shown read-only instead of silently accepting comments that never
      // reach ADO.
      if (api) return { commentApi: api, perDocNoWriteTarget: false };
      return { commentApi: commentApiRef.current!, perDocNoWriteTarget: true };
    }
    return { commentApi: commentApiRef.current!, perDocNoWriteTarget: false };
  }, [commentApiForPath, selectedPath]);

  // Effective routed-PR pill. Per-document mode resolves it from the selected
  // file (its own routing PR); otherwise the single `routedPr` prop is used.
  const routedPrResolution = React.useMemo<RoutedPrInfo | null | undefined>(
    () => (routedPrForPath ? routedPrForPath(selectedPath) : routedPr),
    [routedPrForPath, selectedPath, routedPr],
  );

  // Keep the identity resolver pointed at the current effective CommentApi.
  /* v8 ignore start -- else-arm hit only when the effective CommentApi lacks resolveIdentities */
  resolveIdentitiesRef.current = commentApi.resolveIdentities
    ? (ids) => commentApi.resolveIdentities!(ids)
    : undefined;
  /* v8 ignore stop */

  return {
    identityStore,
    commentApi,
    perDocNoWriteTarget,
    routedPrResolution,
    effectiveRoutedPr: routedPrResolution ?? undefined,
  };
}
