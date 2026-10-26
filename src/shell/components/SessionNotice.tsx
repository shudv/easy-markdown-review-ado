// Non-blocking notice shown while the ADO token dead window is in effect (see
// shell/adoSession.ts). It appears as soon as any request confirms the spell —
// usually the background comment poll — so the user learns about it before
// posting. Plain language only: the window normally clears by itself, so the
// reload is offered as a quiet link, not the main action (it helps about 3 in
// 4 times and costs the reader their place). While changes are waiting to be
// saved, or an inline edit is open, the link is hidden: a reload would drop them.

import * as React from "react";

import {
  adoSession,
  useAdoSession,
  type AdoSessionMonitor,
} from "../adoSession";

export function SessionNotice({
  monitor = adoSession,
  reloadAllowed = true,
}: {
  monitor?: AdoSessionMonitor;
  /**
   * False while the user has unsaved work a reload would drop (an open inline
   * edit — new comments and replies are kept as drafts).
   */
  reloadAllowed?: boolean;
}): React.ReactElement | null {
  const session = useAdoSession(monitor);
  if (session.state !== "refreshing") return null;
  return (
    <div className="emr-toast emr-toast--info" role="status">
      <span className="emr-toast-msg">
        {session.heldWrites > 0
          ? "Reconnecting to Azure DevOps — your changes will be saved automatically."
          : "Reconnecting to Azure DevOps — this usually fixes itself within a few minutes."}
      </span>
      {session.canReload && session.heldWrites === 0 && reloadAllowed ? (
        <button
          type="button"
          className="emr-toast-link"
          onClick={() => void monitor.reloadHost("user")}
        >
          Reload page
        </button>
      ) : null}
    </div>
  );
}
