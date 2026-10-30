// Context providers PrShell wraps its comment UI in.

import * as React from "react";

import { CommentApiProvider, type CommentApi } from "../../comments/api";
import { ComposerBusyContext } from "../components/composerBusy";
import { RegisterEditorContext } from "../components/editorRegistry";

/**
 * The comment API plus the "a write is in flight" flag every Composer reads
 * (see ComposerBusyContext), provided together at one tree level.
 */
export function CommentApiScope({
  api,
  busy,
  registerEditor,
  children,
}: {
  api: CommentApi;
  busy: boolean;
  registerEditor: () => () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <CommentApiProvider value={api}>
      <ComposerBusyContext.Provider value={busy}>
        <RegisterEditorContext.Provider value={registerEditor}>
          {children}
        </RegisterEditorContext.Provider>
      </ComposerBusyContext.Provider>
    </CommentApiProvider>
  );
}
