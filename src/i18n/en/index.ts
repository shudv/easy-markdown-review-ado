// The English source catalog: the single source of truth for message keys.
// Each area lives in its own file; keys are prefixed with their area so the
// spread below can never silently shadow one area's string with another's
// (test/i18n.catalog.test.ts checks this).

import { comments } from "./comments";
import { common } from "./common";
import { document } from "./document";
import { hub } from "./hub";
import { navigation } from "./navigation";
import { shell } from "./shell";

export const AREAS = { common, hub, document, comments, navigation, shell } as const;

export const en = {
    ...common,
    ...hub,
    ...document,
    ...comments,
    ...navigation,
    ...shell,
} as const;

export type Messages = typeof en;
export type MessageKey = keyof Messages;
