// Presentational pieces of the GeneratedSourceModal header and code pane.

import { Fragment, type ReactElement } from "react";

import { t } from "../../i18n";
import { diffCharacters, diffWords, type WordDiffOp } from "../../markdown/wordDiff";
import { WORD_ADDED_CLASS, removedRunClass } from "../../markdown/wordDiffDom";

type GeneratedSourceKind = "mermaid" | "math";

/** Kind glyph + title at the left of the modal header. */
export function GeneratedSourceIdentity(
    props: Readonly<{
        kind: GeneratedSourceKind;
    }>,
): ReactElement {
    const isMath = props.kind === "math";

    return (
        <div className="emr-generated-source-identity">
            <span className="emr-generated-source-kind" aria-hidden="true">
                {isMath ? (
                    "ƒx"
                ) : (
                    <svg viewBox="0 0 24 24">
                        <rect x="9" y="3" width="6" height="5" rx="1" />
                        <rect x="3" y="16" width="6" height="5" rx="1" />
                        <rect x="15" y="16" width="6" height="5" rx="1" />
                        <path d="M12 8v3.5M6 16v-2.5h12V16" />
                    </svg>
                )}
            </span>
            <span className="emr-generated-source-title">
                {isMath
                    ? t("document.generatedSource.equationTitle")
                    : t("document.generatedSource.diagramTitle")}
            </span>
        </div>
    );
}

/** Changes + Before toggles, shown only when the source changed in the PR. */
export function GeneratedSourceViewControls(
    props: Readonly<{
        beforeShown: boolean;
        changesShown: boolean;
        onToggleBefore: () => void;
        onToggleChanges: () => void;
    }>,
): ReactElement {
    const { beforeShown, changesShown, onToggleBefore, onToggleChanges } = props;

    const changesLabel = changesShown
        ? t("document.generatedSource.hideChanges")
        : t("document.generatedSource.showChanges");

    return (
        <div className="emr-generated-source-view-controls">
            {!beforeShown ? (
                <button
                    type="button"
                    className="emr-generated-source-toggle emr-generated-source-changes is-toggle"
                    aria-pressed={changesShown}
                    aria-label={changesLabel}
                    title={changesLabel}
                    onClick={onToggleChanges}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 2.5v13" />
                        <path d="M5.5 9h13" />
                        <path d="M5.5 21h13" />
                    </svg>
                </button>
            ) : null}
            <button
                type="button"
                className="emr-generated-source-toggle emr-generated-source-before is-toggle"
                aria-pressed={beforeShown}
                title={
                    beforeShown
                        ? t("document.generatedSource.returnToCurrent")
                        : t("document.generatedSource.showPrevious")
                }
                onClick={onToggleBefore}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v6h6" />
                </svg>
                <span>{t("common.before")}</span>
            </button>
        </div>
    );
}

/**
 * Word-level (character-level for math) diff of the definition, so reviewers
 * see exactly what moved in the PR.
 */
export function GeneratedSourceDiff(
    props: Readonly<{
        kind: GeneratedSourceKind;
        original: string;
        current: string;
    }>,
): ReactElement {
    const { kind, original, current } = props;
    const diff = kind === "math" ? diffCharacters : diffWords;

    return (
        <code className="emr-generated-source-code-diff">
            {diff(original, current).map((op, i) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- Diff ops are a positional sequence recomputed wholesale from the two strings; runs have no identity beyond their position (values can repeat).
                <Fragment key={i}>{renderDiffOp(op)}</Fragment>
            ))}
        </code>
    );
}

function renderDiffOp(op: WordDiffOp): ReactElement {
    if (op.kind === "added") {
        return <ins className={WORD_ADDED_CLASS}>{op.value}</ins>;
    }

    if (op.kind === "removed") {
        return <del className={removedRunClass(op.value)}>{op.value}</del>;
    }

    return <span>{op.value}</span>;
}
