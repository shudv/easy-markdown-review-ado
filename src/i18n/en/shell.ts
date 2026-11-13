// Shell orchestration: notices, pane chrome, read-only reasons, update/version labels, progress messages, thread mutation names.

import type { MessageValue } from "../types";

export const shell = {
    "shell.article.openFailed.title": "Couldn’t open this document",
    "shell.article.openFailed.body":
        "{path} couldn’t be loaded. It may have been moved or deleted, or you may not have access to it. Pick another document from the navigation.",
    "shell.article.versionFailed.title": "Couldn’t load this version",
    "shell.article.versionFailed.body":
        "{path} couldn’t be loaded at the selected revision. It may not exist at that commit, or you may not have access to it.",
    "shell.article.absent.body": "{path}: {reason}",
    "shell.article.showAllUpdates": "Show all updates",
    "shell.notices.missingDoc":
        "{missing} is no longer in this repository — it may have been moved or deleted. Showing {shown} instead.",
    "shell.tooNarrow.title": "More room needed",
    "shell.tooNarrow.body":
        "There isn’t enough width to show the document comfortably. Widen the window to keep reading.",
    "shell.panes.resizeNavigation": "Drag to resize navigation (double-click to reset)",
    "shell.panes.resizeComments": "Drag to resize comments (double-click to reset)",
    "shell.panes.reopenNavigation": "Drag to reopen navigation",
    "shell.panes.reopenComments": "Drag to reopen comments",
    "shell.activity.refreshingFilesAndComments": "Refreshing files and comments…",
    "shell.activity.syncingComments": "Syncing comments…",
    "shell.activity.refreshingFiles": "Refreshing files…",
    "shell.activity.loadingDocumentVersion": "Loading document version…",
    "shell.activity.loadingDocument": "Loading document…",
    "shell.absent.deleted.title": "Deleted by Update {update}",
    "shell.absent.deleted.body":
        "This file was deleted in this pull request by Update {update}, so there's nothing to show for the selected updates.",
    "shell.absent.added.title": "Not added yet at Update {update}",
    "shell.absent.added.body":
        "This pull request adds this file in a later update, so it doesn't exist yet at Update {update}.",
    "shell.absent.missing.title": "Not present at Update {update}",
    "shell.absent.missing.body":
        "This file doesn't exist at Update {update} of this pull request (it may have been moved or renamed).",
    "shell.writeError.sessionRefreshing":
        "{action} didn't go through — your Azure DevOps session is refreshing. Reload the page, then try again; your draft is saved.",
    "shell.writeError.sessionRefreshed":
        "{action} didn't go through — your session refreshed. Please try again.",
    "shell.writeError.connection":
        "{action} didn't go through — check your connection and try again.",
    "shell.writeError.serverReason": "{action} failed: {reason}",
    "shell.writeError.generic": "{action} didn't go through. Please try again.",
    "shell.writeAction.createComment": "Create comment",
    "shell.writeAction.addReply": "Add reply",
    "shell.writeAction.resolveThread": "Resolve thread",
    "shell.writeAction.reopenThread": "Reopen thread",
    "shell.writeAction.markThreadPending": "Mark thread pending",
    "shell.writeAction.closeThread": "Close thread",
    "shell.writeAction.editComment": "Edit comment",
    "shell.writeAction.deleteComment": "Delete comment",
    "shell.writeAction.deleteThread": "Delete thread",
    "shell.writeAction.toggleReaction": "Toggle reaction",
    "shell.wordDelta.added": {
        one: "{count} word added",
        other: "{count} words added",
    },
    "shell.wordDelta.removed": {
        one: "{count} word removed",
        other: "{count} words removed",
    },
    "shell.range.baseToUpdate": "Base → Update {to}",
    "shell.range.updateToUpdate": "Update {from} → {to}",
    "shell.history.noEarlierVersions": "No earlier versions",
    "shell.history.alreadyCurrent": "Already at the current version",
    "shell.history.olderVersion": "Older version — {target}",
    "shell.history.newerVersion": "Newer version — {target}",
    "shell.history.target.currentWithPr": "current version (PR #{prId})",
    "shell.history.target.current": "current version",
    "shell.history.target.prWithTitle": "PR #{prId}: {title}",
    "shell.history.target.pr": "PR #{prId}",
    "shell.history.pastPrFallbackTitle": "PR #{prId}",
    "shell.readOnly.noCompletedPr":
        "Comments are read-only here — this document isn't part of a completed pull request yet.",
    "shell.readOnly.pastPr":
        "Viewing this document as it was at pull request #{prId}. Comments here are read-only — open the pull request to reply.",
    "shell.readOnly.deletedFile":
        "This document was deleted in this pull request. Its previous version is read-only.",
    "shell.readOnly.commentsUnavailable":
        "Comments are unavailable until this document is part of a completed pull request.",
    "shell.commentBlocker.message":
        "This text changed in a later update, so a comment can't be attached to it.",
    "shell.commentBlocker.action": "Compare up to Update {update}",
    "shell.refresh.filesAndComments": "Refresh files and comments",
    "shell.refresh.comments": "Refresh comments",
} as const satisfies Record<string, MessageValue>;
