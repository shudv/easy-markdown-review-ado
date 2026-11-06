// Shell: comment API, routed-PR pill and identity store per document.

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { LocalOnlyCommentApi, type CommentApi } from "../../comments/api";
import {
  IdentityStore,
  type IdentityResolver,
} from "../../comments/identityStore";
import type { RoutedPrInfo } from "./types";

/** The shell's CommentApi instances that must survive re-renders. */
interface ApiRouting {
  /** The latest host-supplied CommentApi, or the session-local fallback. */
  stable: CommentApi | null;
  /** Per-document routing cache (Documents hub "transparent PR" mode). */
  perPath: Map<string, CommentApi>;
}

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
  // session-local stub so standalone dev still works. The per-document cache
  // lives alongside it; the effective `commentApi` is resolved from
  // `selectedPath` further below.
  const routingRef = useRef<ApiRouting>({
    stable: null,
    perPath: new Map(),
  });

  // eslint-disable-next-line react-hooks/refs -- the memo below reads the stable API in this same render, so the latest host API must be recorded before it rather than in an effect.
  syncStableApi(routingRef.current, opts.commentApi);

  // Shared identity store: one GUID→name cache reused by every rendered comment
  // so `@<GUID>` user mentions resolve consistently (ADO-style). The resolver
  // reads the latest effective CommentApi via a ref so a per-document API swap
  // still resolves; the store is created once and provided to the subtree.
  const resolveIdentitiesRef = useRef<IdentityResolver | undefined>(undefined);

  const [identityStore] = useState(
    // eslint-disable-next-line react-hooks/refs -- the store calls this resolver only when it flushes on a microtask, so the ref is read after render, never during it.
    () =>
      new IdentityStore((ids) =>
        resolveIdentitiesRef.current
          ? resolveIdentitiesRef.current(ids)
          : Promise.resolve({}),
      ),
  );

  // Effective CommentApi. In per-document mode it's resolved (and cached) from
  // the selected file so each document writes to its own housing PR; otherwise
  // it's the single stable instance from props / the local fallback.
  const { commentApi, perDocNoWriteTarget } = useMemo(
    // eslint-disable-next-line react-hooks/refs -- the per-path cache is a mutable instance cache, not render state; memoised on path/resolver only, so a newly supplied host API applies from the next path change, as before.
    () => resolveApi(routingRef.current, commentApiForPath, selectedPath),
    [commentApiForPath, selectedPath],
  );

  // Effective routed-PR pill. Per-document mode resolves it from the selected
  // file (its own routing PR); otherwise the single `routedPr` prop is used.
  const routedPrResolution = useMemo<RoutedPrInfo | null | undefined>(
    () => (routedPrForPath ? routedPrForPath(selectedPath) : routedPr),
    [routedPrForPath, selectedPath, routedPr],
  );

  // Keep the identity resolver pointed at the current effective CommentApi.
  // The store only calls it from a microtask queued by an effect, so it always
  // runs after this commit's layout effects.
  useLayoutEffect(() => {
    resolveIdentitiesRef.current = commentApi.resolveIdentities
      ? (ids) => commentApi.resolveIdentities!(ids)
      : undefined;
  });

  return {
    identityStore,
    commentApi,
    perDocNoWriteTarget,
    routedPrResolution,
    effectiveRoutedPr: routedPrResolution ?? undefined,
  };
}

/**
 * Records the latest host-supplied CommentApi. A later `undefined` keeps the
 * last one; with none ever supplied, a session-local stub is created once.
 */
function syncStableApi(
  routing: ApiRouting,
  commentApi: CommentApi | undefined,
): void {
  routing.stable = commentApi ?? routing.stable ?? new LocalOnlyCommentApi();
}

/**
 * The effective CommentApi. In per-document mode it's resolved (and cached)
 * from the selected file so each document writes to its own housing PR;
 * otherwise it's the single stable instance from props / the local fallback.
 */
function resolveApi(
  routing: ApiRouting,
  commentApiForPath: CommentApiRoutingOptions["commentApiForPath"],
  selectedPath: string,
): { commentApi: CommentApi; perDocNoWriteTarget: boolean } {
  const stable = routing.stable!;

  if (!commentApiForPath) {
    return { commentApi: stable, perDocNoWriteTarget: false };
  }

  let api = routing.perPath.get(selectedPath);

  if (!api) {
    // A document whose housing PR isn't resolved yet — or has none —
    // resolves to `undefined`; don't cache the fallback.
    api = commentApiForPath(selectedPath);
    if (api) routing.perPath.set(selectedPath, api);
  }

  // No routed PR to persist to: still render via the session-local stub, but
  // flag the document as having no write target so the composer is shown
  // read-only instead of silently accepting comments that never reach ADO.
  if (api) return { commentApi: api, perDocNoWriteTarget: false };

  return { commentApi: stable, perDocNoWriteTarget: true };
}
