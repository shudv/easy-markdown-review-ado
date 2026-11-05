// Documents hub: which document is open, kept in sync with the route.

import { useEffect, useRef, useState } from "react";

import type { PrInfo } from "../types";
import {
  resolveInitialDocPath,
  shouldPublishDefaultPath,
} from "./documentsAppRouting";
import type { DocumentsAppProps } from "./documentsAppProps";

/**
 * Track the active document path so the "Link to comment" builder can encode
 * it. Seeded from the deep-link/cache path (or the first file Shell will
 * open), updated as the user navigates, and reset when the repo switches.
 */
export function useActiveDocPath(
  selectedRepoId: string,
  syntheticPr: PrInfo | null,
  initialSelectedPathForShell: string | undefined,
  onSelectPath: DocumentsAppProps["onSelectPath"],
) {
  const [activeDocPath, setActiveDocPath] = useState<string>(
    resolveInitialDocPath(
      initialSelectedPathForShell,
      syntheticPr?.files[0]?.path,
    ),
  );
  // The repo whose open document we've already published to the route. It
  // trails `selectedRepoId` until that repo's files resolve, then we publish
  // its initial/default document exactly once.
  const activeDocRepoRef = useRef(selectedRepoId);
  const publishedRepoRef = useRef<string | null>(null);
  useEffect(() => {
    // Repo switch: clear the active path immediately so the comment-link
    // builder (and `activeDocPath`) never momentarily point at the *previous*
    // repo's document while the new repo's default document resolves.
    if (activeDocRepoRef.current !== selectedRepoId) {
      activeDocRepoRef.current = selectedRepoId;
      setActiveDocPath(initialSelectedPathForShell ?? "");
    }

    // Publish the repo's initial/default document to the route exactly once —
    // Shell opens it without emitting a selection, so the route's `?path=`
    // would otherwise stay stale (the previous repo's doc) or empty.
    //
    // CRITICAL: this must be RE-EVALUATED as `syntheticPr` streams in, not run
    // once on switch. In paginated mode a repo (the initial one OR a
    // freshly-picked one) first arrives as a content-less skeleton, so its
    // `files` are empty on the switch render; a one-shot publish would miss the
    // default doc entirely. We guard per-repo via `publishedRepoRef` so we
    // still publish only once, but retry on later renders until files land.
    //
    // The deep-link / cache path (`initialSelectedPathForShell`) wins when set
    // and is available immediately (no skeleton wait), so the bare-URL cache
    // restore is still back-filled to `?repo=…&path=…` on the first render.
    // Republishing is idempotent — `setRouteQuery` merges, preserving
    // `?comment=`.
    if (publishedRepoRef.current === selectedRepoId) return;
    const nextPath = resolveInitialDocPath(
      initialSelectedPathForShell,
      syntheticPr?.files[0]?.path,
    );
    if (
      !shouldPublishDefaultPath(
        publishedRepoRef.current,
        selectedRepoId,
        nextPath,
      )
    ) {
      return; // files not resolved yet — retry on the next render
    }
    publishedRepoRef.current = selectedRepoId;
    setActiveDocPath(nextPath);
    onSelectPath?.(selectedRepoId, nextPath);
  }, [selectedRepoId, syntheticPr, initialSelectedPathForShell, onSelectPath]);

  return [activeDocPath, setActiveDocPath] as const;
}
