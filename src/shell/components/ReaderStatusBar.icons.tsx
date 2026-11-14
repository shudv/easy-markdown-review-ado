// Icons and the separator used by the reader status bar.

import type { ReactElement, ReactNode } from "react";

// ---- Icons (24-viewBox, stroke = currentColor) ----------------------------

export function IconNav(): ReactElement {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
        </svg>
    );
}

export function IconComments(): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
        >
            <path d="M21 11.5a8.4 8.4 0 0 1-11.5 7.8L3 21l1.7-6.5A8.4 8.4 0 1 1 21 11.5z" />
        </svg>
    );
}

export function IconChanges(): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 2.5v13" />
            <path d="M5.5 9h13" />
            <path d="M5.5 21h13" />
        </svg>
    );
}

export function IconCaret(): ReactElement {
    return (
        <svg
            className="emr-statusbar-caret"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m6 15 6-6 6 6" />
        </svg>
    );
}

export function IconChevron({
    direction,
}: Readonly<{
    direction: "left" | "right";
}>): ReactElement {
    return (
        <svg
            className="emr-statusbar-iteration-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
        </svg>
    );
}

export function StatusBarSeparator(): ReactElement {
    return <div className="emr-statusbar-sep" aria-hidden="true" />;
}

export function IconOutline(): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
        >
            <path d="M5 6h14" />
            <path d="M9 12h10" />
            <path d="M9 18h10" />
        </svg>
    );
}

export function IconCheck(): ReactElement {
    return (
        <svg
            className="emr-statusbar-font-check"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

export function IconPullRequest(): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="5" r="2" />
            <path d="M6 7v10" />
            <path d="M18 7v3a5 5 0 0 1-5 5h-3" />
        </svg>
    );
}

/** Frame shared by the 1.7-weight, round-jointed status-bar icons. */
function RoundStrokeSvg(
    props: Readonly<{
        children: ReactNode;
    }>,
): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {props.children}
        </svg>
    );
}

export function IconFeedback(): ReactElement {
    return (
        <RoundStrokeSvg>
            <path d="m8 3 1.5 1.7" />
            <path d="M16 3l-1.5 1.7" />
            <path d="M9.2 7.5v-.8a2.8 2.8 0 0 1 5.6 0v.8" />
            <path d="M12 20.5c-3.2 0-5.6-2.6-5.6-5.8v-2.9A3.8 3.8 0 0 1 10.2 8h3.6a3.8 3.8 0 0 1 3.8 3.8v2.9c0 3.2-2.4 5.8-5.6 5.8z" />
            <path d="M12 20.5V11" />
            <path d="M6.4 12H3" />
            <path d="M21 12h-3.4" />
            <path d="M6.6 8.4C5 8.2 3.7 6.9 3.5 5.2" />
            <path d="M17.4 8.4c1.6-.2 2.9-1.5 3.1-3.2" />
            <path d="M6.4 16.2C4.9 16.4 3.7 17.7 3.5 19.4" />
            <path d="M17.6 16.2c1.5.2 2.7 1.5 2.9 3.2" />
        </RoundStrokeSvg>
    );
}

export function IconRefresh(): ReactElement {
    return (
        <RoundStrokeSvg>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
        </RoundStrokeSvg>
    );
}

/** Usage data: a pulse line (activity), struck through when sending is off. */
export function IconUsageData(props: Readonly<{ off: boolean }>): ReactElement {
    return (
        <RoundStrokeSvg>
            <path d="M3 12h3.8l2.4-5.5 4.6 11 2.4-5.5H21" />
            {props.off ? <path d="M3.5 3.5l17 17" /> : null}
        </RoundStrokeSvg>
    );
}
