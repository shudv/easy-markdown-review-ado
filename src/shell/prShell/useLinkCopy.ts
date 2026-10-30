// PrShell: "copy link" actions for headings and selected text.

import * as React from "react";

import { copyText } from "../../comments/clipboard";
import { events, track, trackUserFacingError } from "../../telemetry";
import type { SelectionLinkTarget } from "../components/ArticleView";
import { useDeepLink } from "../deepLink";

/**
 * "Copy link" actions for headings and selected text. Only offered when the
 * host can build a shareable surface URL; on success the host is told so it
 * can mirror the target into the page URL.
 */
export function useLinkCopy(
  onHeadingLinkCopied: ((anchor: string) => void) | undefined,
  onTextLinkCopied:
    | ((text: string, anchor: string | undefined) => void)
    | undefined,
): {
  onCopyHeadingLink: ((anchor: string) => Promise<boolean>) | undefined;
  onCopySelectionLink:
    | ((target: SelectionLinkTarget) => Promise<boolean>)
    | undefined;
} {
  // "Copy link to section" (the heading link button). Only offered when the
  // host can build a shareable surface URL. On success the host is told so it
  // can mirror the anchor into the page URL, as ADO's own preview does.
  const buildDeepLink = useDeepLink();
  const onCopyHeadingLink = React.useMemo(() => {
    if (!buildDeepLink) return undefined;
    return async (anchor: string): Promise<boolean> => {
      const url = buildDeepLink({ kind: "heading", anchor });
      const ok = url ? await copyText(url) : false;
      if (ok) {
        track(events.linkCopied({ target: "heading" }));
        onHeadingLinkCopied?.(anchor);
      } else {
        trackUserFacingError({
          error: new Error(
            url ? "Heading link copy failed" : "Heading link unavailable",
          ),
          source: "PrShell.copyHeadingLink",
          operation: "heading-link-copy",
          impact: "action-failed",
        });
      }
      return ok;
    };
  }, [buildDeepLink, onHeadingLinkCopied]);

  // "Copy link to selection" (the selection bubble's link action): links the
  // quoted text, with its section heading as a fallback.
  const onCopySelectionLink = React.useMemo(() => {
    if (!buildDeepLink) return undefined;
    return async ({ text, anchor }: SelectionLinkTarget): Promise<boolean> => {
      const url = buildDeepLink({ kind: "text", text, anchor });
      const ok = url ? await copyText(url) : false;
      if (ok) {
        track(events.linkCopied({ target: "text" }));
        onTextLinkCopied?.(text, anchor);
      } else {
        trackUserFacingError({
          error: new Error(
            url ? "Text link copy failed" : "Text link unavailable",
          ),
          source: "PrShell.copySelectionLink",
          operation: "text-link-copy",
          impact: "action-failed",
        });
      }
      return ok;
    };
  }, [buildDeepLink, onTextLinkCopied]);

  return { onCopyHeadingLink, onCopySelectionLink };
}
