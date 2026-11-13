// Strings shared across areas. Add here only when two or more areas need the
// same wording in the same role; otherwise keep a string in its own area so
// translators get specific context.

import type { MessageValue } from "../types";

export const common = {
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.close": "Close",
    "common.dismiss": "Dismiss",
    "common.hide": "Hide",
    "common.tryAgain": "Try again",
    "common.reloadPage": "Reload page",
    "common.refresh": "Refresh",
    "common.loading": "Loading…",
    "common.somethingWentWrong": "Something went wrong",
    "common.linkCopied": "Link copied",
    "common.copyLinkFailed": "Couldn't copy link",
    "common.expandSection": "Expand section",
    "common.collapseSection": "Collapse section",
    "common.before": "Before",
    "common.after": "After",
    "common.allUpdates": "All updates",
    "common.documents": "Documents",
    "common.comments": "Comments",
    "common.documentNavigation": "Document navigation",
    "common.loadingDocument": "Loading document",
    "common.closeSearch": "Close search",
    "common.closeSearchEsc": "Close search (Esc)",
    "common.change.added": "Added",
    "common.change.edited": "Edited",
    "common.change.removed": "Removed",
    "common.loadingImage": "Loading image",
    "common.imageUnavailable": "Image unavailable",
} as const satisfies Record<string, MessageValue>;
