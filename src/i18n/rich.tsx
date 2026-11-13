// `tRich`: like `t`, but placeholders can be filled with React nodes, so a
// translated sentence can embed markup (a bolded file name, a link) without
// splitting the sentence into fragments translators can't reorder.

import { Fragment, createElement, type ReactElement, type ReactNode } from "react";

import {
    formatParam,
    selectTemplate,
    splitTemplate,
    type MessageArgs,
    type MessageKey,
} from "./i18n";

export function tRich<K extends MessageKey>(
    key: K,
    ...args: MessageArgs<K, ReactNode>
): ReactElement {
    const params = (args[0] ?? {}) as Record<string, unknown>;
    const parts = splitTemplate(selectTemplate(key, params));

    return createElement(
        Fragment,
        null,
        ...parts.map((part, i) => {
            if (i % 2 === 0) return part;
            const value = params[part];

            return createElement(
                Fragment,
                // Placeholder names are unique within a message, so they make stable keys.
                { key: part },
                typeof value === "number" ? formatParam(part, value) : (value as ReactNode),
            );
        }),
    );
}
