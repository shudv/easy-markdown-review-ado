import { createContext } from "react";

/**
 * Lets an open inline comment editor register itself with the shell (call the
 * function when the editor opens; call what it returns when it closes). Unlike
 * new comments and replies, inline edits are not persisted as drafts, so while
 * one is open the shell hides "Reload page", which would silently drop it.
 */
// Stryker disable next-line ArrowFunction: without a provider, `CommentRow` returns this unregister from an effect, and React treats an undefined cleanup the same as a no-op one
export const RegisterEditorContext = createContext<() => () => void>(() => () => {});
