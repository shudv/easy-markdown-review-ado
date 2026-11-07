// Small monochrome glyphs shared by the Documents hub chrome (DocNav header,
// repo picker, empty state).

import type { ReactElement } from "react";

export function SvgRefresh(props: Readonly<{ spinning?: boolean }>): ReactElement {
    return (
        <svg
            className={`emr-icon ${props.spinning ? "is-spinning" : ""}`}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
        >
            <path
                fill="currentColor"
                d="M8 3a5 5 0 0 1 4.546 2.914.75.75 0 1 0 1.362-.628A6.5 6.5 0 1 0 14.5 8a.75.75 0 0 0-1.5 0A5 5 0 1 1 8 3Z"
            />
            <path
                fill="currentColor"
                d="M14 2.5a.75.75 0 0 0-1.5 0V5h-2.5a.75.75 0 0 0 0 1.5h3.25A.75.75 0 0 0 14 5.75V2.5Z"
            />
        </svg>
    );
}

/**
 * Subtle monochrome git-repository glyph (Octicon "repo"). Drawn in
 * `currentColor` at reduced opacity via CSS so it reads as a quiet affordance
 * rather than a bright brand mark — keeping with the app's minimal aesthetic.
 */
export function SvgRepo(): ReactElement {
    // Azure DevOps Repos glyph (the git-branch "bowtie-git" mark the product uses
    // for repositories), drawn in currentColor so it inherits the picker's tone.
    return (
        <svg
            className="emr-docnav-repo-glyph"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
        >
            <path
                fill="currentColor"
                d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
            />
        </svg>
    );
}
