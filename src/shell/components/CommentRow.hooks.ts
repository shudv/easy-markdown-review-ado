// State + effect clusters behind a CommentRow: the inline edit session, the
// ⋯ menu (with its delete confirmation), and the "Link to comment" copy.

import * as React from "react";
import { copyText } from "../../comments/clipboard";
import { events, track, trackUserFacingError } from "../../telemetry";
import { useDeepLink } from "../deepLink";
import type { CommentLinkState } from "./CommentRow.helpers";
import { RegisterEditorContext } from "./editorRegistry";

/** Which delete the ⋯ menu is asking the user to confirm, if any. */
export type ConfirmMode = null | "comment" | "thread";

export function useCommentEditSession(
  onEdit: (
    threadId: string,
    commentId: string,
    newBody: string,
  ) => void | Promise<boolean>,
  threadId: string,
  commentId: string,
) {
  const [editing, setEditing] = React.useState(false);
  // Each open of the editor is a new session; a save that lands later (e.g.
  // held through an Azure DevOps reconnect) may only close the session it
  // came from, and only while that editor still shows exactly what was saved.
  const editSessionRef = React.useRef(0);
  const editTextRef = React.useRef("");
  const registerEditor = React.useContext(RegisterEditorContext);
  React.useEffect(
    () => (editing ? registerEditor() : undefined),
    [editing, registerEditor],
  );

  const begin = () => {
    editSessionRef.current += 1;
    setEditing(true);
  };

  const onChange = (text: string) => {
    editTextRef.current = text;
  };

  const onSubmit = (body: string) => {
    // Close only once the save went through, and only the editor
    // session that sent it, still holding exactly that text. A
    // failed save, newer typing, or a cancel-and-reopen keeps the
    // user's current text on screen.
    const session = editSessionRef.current;
    void Promise.resolve(onEdit(threadId, commentId, body)).then((saved) => {
      if (saved === false) return;
      if (editSessionRef.current !== session) return;
      if (editTextRef.current.trim() !== body) return;
      setEditing(false);
    });
  };

  const onCancel = () => {
    editSessionRef.current += 1;
    setEditing(false);
  };

  return { editing, begin, onChange, onSubmit, onCancel };
}

export function useCommentRowMenu() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<ConfirmMode>(null);

  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);

  // Close menu on outside click / Escape.
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        menuRef.current &&
        target &&
        !menuRef.current.contains(target) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(target)
      ) {
        setMenuOpen(false);
        setConfirm(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      /* v8 ignore next -- Escape-to-close key branch; not exercised in the render harness */
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        setConfirm(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const close = () => {
    setMenuOpen(false);
    setConfirm(null);
  };

  const toggle = () => {
    setMenuOpen((o) => !o);
    setConfirm(null);
  };

  return { menuOpen, confirm, setConfirm, menuRef, menuBtnRef, close, toggle };
}

export function useCommentLinkCopy(threadId: string) {
  const [linkState, setLinkState] = React.useState<CommentLinkState>("idle");
  // Host-supplied builder for a shareable deep link to this thread. Absent on
  // surfaces with no shareable URL, where the "Link to comment" item is hidden
  // (the iframe's own URL is a CDN asset that opens a blank page).
  const buildDeepLink = useDeepLink();

  const handleLink = () => {
    /* v8 ignore next -- the item only renders when a builder exists */
    if (!buildDeepLink) return;
    const url = buildDeepLink({ kind: "comment", threadId });
    // Keep the menu open so the inline label confirms the result. `copyText`
    // resolves to a boolean (never rejects), so a host iframe blocking the
    // async Clipboard API can't surface as an unhandled rejection — and we only
    // claim success when a copy is actually confirmed.
    const copied = url ? copyText(url) : Promise.resolve(false);
    void copied.then((ok) => {
      setLinkState(ok ? "copied" : "failed");
      if (ok) {
        track(events.linkCopied({ target: "comment" }));
      } else {
        trackUserFacingError({
          error: new Error(
            url ? "Comment link copy failed" : "Comment link unavailable",
          ),
          source: "CommentRow.copyLink",
          operation: "comment-link-copy",
          impact: "action-failed",
        });
      }
      window.setTimeout(() => setLinkState("idle"), ok ? 1200 : 2400);
    });
  };

  return { canLink: buildDeepLink !== null, linkState, handleLink };
}
