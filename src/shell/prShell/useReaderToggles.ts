// PrShell: comment filter/search and change-highlight toggles.

import * as React from "react";

import { events, track } from "../../telemetry";
import type { CommentFilterMode } from "../components/commentFilter";

/**
 * The reader's view toggles: the comment filter + search, the "only this
 * file" scope, and the change-highlights switch.
 */
export function useReaderToggles() {
  const [commentFilter, setCommentFilter] =
    React.useState<CommentFilterMode>("active");
  // Scope toggle paired with the filter: hide comments not on the current file
  // (General/Overview + comments on files no longer in the PR).
  const [onlyThisFile, setOnlyThisFile] = React.useState(false);
  // Reader preference: whether the PR change highlights are shown. Defaults to
  // visible; the global toggle in the DocNav header flips it so a reader can
  // drop to the clean, latest version of every document at any time.
  const [diffHidden, setDiffHidden] = React.useState(false);
  // Comment rail search query (filters comments by body / author).
  const [commentQuery, setCommentQuery] = React.useState("");

  // Global "show / hide changes" switch, rendered in the DocNav header so it
  // reads as a single preference over the whole document set rather than a
  // pill floating on one article. Gated on `diffAvailable` so it only appears
  // for the CURRENTLY-viewed file when that file actually has a displayable
  // edit diff — i.e. an *edited* file. A wholesale added/deleted file (every
  // line one colour), a historical snapshot, or a locally-edited buffer has no
  // meaningful diff to toggle, so the control is hidden rather than shown
  // inertly. (`diffAvailable` already folds in the added/deleted, historical,
  // and dirty-buffer rules.)
  //
  // Telemetry-wrapped UI toggles. The presentational children stay oblivious;
  // the container records the engagement action alongside the state change.
  const handleToggleDiff = React.useCallback(() => {
    // After the flip, the diff is visible iff it was hidden beforehand.
    const nowVisible = diffHidden;
    setDiffHidden((v) => !v);
    track(events.diffToggled({ visible: nowVisible }));
  }, [diffHidden]);

  const handleFilterModeChange = React.useCallback(
    (mode: CommentFilterMode) => {
      setCommentFilter(mode);
      track(events.commentFiltered({ mode, scoped: onlyThisFile }));
    },
    [onlyThisFile],
  );

  const handleOnlyThisFileChange = React.useCallback(
    (value: boolean) => {
      setOnlyThisFile(value);
      track(events.commentFiltered({ mode: commentFilter, scoped: value }));
    },
    [commentFilter],
  );

  return {
    commentFilter,
    onlyThisFile,
    diffHidden,
    commentQuery,
    setCommentQuery,
    handleToggleDiff,
    handleFilterModeChange,
    handleOnlyThisFileChange,
  };
}
