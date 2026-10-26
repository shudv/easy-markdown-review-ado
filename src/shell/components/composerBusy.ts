import { createContext } from "react";

/**
 * True while a comment write is in flight. Every `Composer` under the provider
 * disables its submit button meanwhile, so a slow write — including one held
 * for minutes through the ADO token dead window — can't be submitted twice and
 * post a duplicate comment.
 */
export const ComposerBusyContext = createContext(false);
