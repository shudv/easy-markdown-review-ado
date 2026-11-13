// Shell toasts, session notice and draft-guard dialog.

import type { ReactElement } from "react";

import { t, tRich } from "../../i18n";
import { DraftGuardDialog } from "../components/DraftGuardDialog";
import { SessionNotice } from "../components/SessionNotice";
import type { DraftTarget } from "../draftStorage";

interface ShellNoticesProps {
    persistError: string | null;
    onDismissPersistError: () => void;
    /** Whether the reconnect notice may offer "Reload page". */
    reloadAllowed: boolean;
    missingDoc: { missing: string; shown: string } | null;
    onDismissMissingDoc: () => void;
    draftGuard: {
        requested: DraftTarget;
        existingPath: string;
        snippet: string;
    } | null;
    onDiscardExistingDraft: () => void;
    onKeepExistingDraft: () => void;
}

/**
 * The shell's transient overlays: the failed-write toast, the session
 * reconnect notice, the replaced-missing-document toast, and the draft-guard
 * discard prompt.
 */
export function ShellNotices(props: Readonly<ShellNoticesProps>): ReactElement {
    const { persistError, missingDoc, draftGuard } = props;

    return (
        <>
            {persistError !== null && persistError !== "" ? (
                <div className="emr-toast emr-toast--error" role="alert">
                    <span className="emr-toast-icon" aria-hidden="true">
                        ⚠
                    </span>
                    <span className="emr-toast-msg">{persistError}</span>
                    <button
                        type="button"
                        className="emr-toast-dismiss"
                        onClick={props.onDismissPersistError}
                        aria-label={t("common.dismiss")}
                    >
                        ×
                    </button>
                </div>
            ) : null}
            <SessionNotice reloadAllowed={props.reloadAllowed} />
            {missingDoc ? (
                <div className="emr-toast emr-toast--info" role="status">
                    <span className="emr-toast-msg">
                        {tRich("shell.notices.missingDoc", {
                            missing: <code>{missingDoc.missing}</code>,
                            shown: <code>{missingDoc.shown}</code>,
                        })}
                    </span>
                    <button
                        type="button"
                        className="emr-toast-dismiss"
                        onClick={props.onDismissMissingDoc}
                        aria-label={t("common.dismiss")}
                    >
                        ×
                    </button>
                </div>
            ) : null}
            {draftGuard ? (
                <DraftGuardDialog
                    fileName={
                        draftGuard.existingPath.split("/").filter(Boolean).pop() ??
                        draftGuard.existingPath
                    }
                    snippet={draftGuard.snippet}
                    onDiscard={props.onDiscardExistingDraft}
                    onKeepEditing={props.onKeepExistingDraft}
                />
            ) : null}
        </>
    );
}
