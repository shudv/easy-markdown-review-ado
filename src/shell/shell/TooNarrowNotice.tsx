// Shell's "more room needed" notice for too-narrow frames.

import type { ReactElement } from "react";

import { t } from "../../i18n";

/**
 * Graceful degradation notice — hidden until `.is-too-narrow` (set by the
 * frame ResizeObserver), when it replaces the reader columns so the layout
 * never crushes the prose.
 */
export function TooNarrowNotice(): ReactElement {
    return (
        <div className="emr-too-narrow" role="status">
            <div className="emr-too-narrow-card">
                <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M9 8 5 12l4 4M15 8l4 4-4 4M5 12h14" />
                </svg>
                <h3>{t("shell.tooNarrow.title")}</h3>
                <p>{t("shell.tooNarrow.body")}</p>
            </div>
        </div>
    );
}
