import { createContext } from "react";

/**
 * Lets an open inline comment editor register itself with the shell (call the
 * function when the editor opens; call what it returns when it closes). Unlike
 * new comments and replies, inline edits are not persisted as drafts, so while
 * one is open the shell hides "Reload page", which would silently drop it.
 */
export const RegisterEditorContext = createContext<() => () => void>(
  () => () => {},
);
