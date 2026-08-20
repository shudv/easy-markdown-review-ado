// Render a single comment's Markdown body to safe HTML.
//
// Memoizes by `body` since rendering is moderately expensive (full unified
// pipeline pass) and comment bodies don't change after creation in most
// cases.

import * as React from "react";
import { decorateCommentMedia } from "../../comments/commentMedia";
import { renderMarkdownSync } from "../../markdown/render";
import { useMentionLinkHydration } from "../../comments/mentionLinks";
import { useUserMentionHydration } from "../../comments/identityStore";
import { resolveAdoAttachmentObjectUrl } from "../adoAttachmentMedia";

interface Props {
  body: string;
}

export function CommentMarkdown({ body }: Props): React.ReactElement {
  const html = React.useMemo(() => renderMarkdownSync(body), [body]);
  const ref = React.useRef<HTMLDivElement | null>(null);
  // Rewrite `mention://workitem/...` / `mention://pullrequest/...` href
  // placeholders to real ADO web URLs once the surrounding app has
  // provided org/project context via `MentionLinkContext`.
  useMentionLinkHydration(ref, [html]);
  // Fill `@<GUID>` user mentions with the person's display name from the shared
  // identity store (resolving unknown ids lazily).
  useUserMentionHydration(ref, [html]);
  React.useLayoutEffect(() => {
    const root = ref.current;
    /* v8 ignore next -- the div ref is attached whenever this effect runs */
    if (!root) return;
    return decorateCommentMedia(root, resolveAdoAttachmentObjectUrl);
  }, [html]);
  return (
    <div
      ref={ref}
      className="emr-comment-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
