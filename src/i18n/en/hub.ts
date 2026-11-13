// Documents hub, PR tab, boot/error screens and other app-level chrome (src/hub, src/pr-tab, telemetry/ErrorBoundary, shell boot/session notices).

import type { MessageValue } from "../types";

export const hub = {
    "hub.prTab.eta.fewMinutes": "within a few minutes",
    "hub.prTab.eta.oneMinute": "within a minute",
    "hub.prTab.eta.aboutMinutes": {
        one: "within about {count} minute",
        other: "within about {count} minutes",
    },
    "hub.prTab.reconnecting.title": "Reconnecting to Azure DevOps…",
    "hub.prTab.reconnecting.momentary": "This only takes a moment.",
    "hub.prTab.reconnecting.expiredSignIn":
        "Azure DevOps is still giving this tab an expired sign-in, so reloading won't help. It will continue by itself {eta}.",
    "hub.prTab.reconnecting.usuallyFixes": "This usually fixes itself within a few minutes.",
    "hub.prTab.reconnecting.why": "Why this happens (known Azure DevOps issue)",
    "hub.prTab.noMarkdown.title": "No Markdown files changed in this PR",
    "hub.prTab.noMarkdown.body":
        "This tab shows the pull request's .md files. Switch to the Files tab for the rest, or read this repository's documents.",
    "hub.prTab.noMarkdown.browse": "Browse repository documents",
    "hub.prTab.openAllDocuments.title": "Open all of this repository's documents (new tab)",
    "hub.prTab.openAllDocuments.label": "Open all of this repository's documents in a new tab",
    "hub.prTab.slowBoot": "Azure DevOps is slow to respond — still loading…",
    "hub.prTab.checkingForUpdates": "Checking for updates…",
    "hub.prTab.loading": "Loading pull request",
    "hub.prTab.iterationFallback": "Iteration {id}",
    "hub.pr.untitled": "(untitled PR)",
    "hub.pr.titleFallback": "PR #{id}",
    "hub.docs.refresh": "Refresh repository contents and PR routing",
    "hub.docs.noRepos.title": "No repositories",
    "hub.docs.noRepos.body": "This project has no Markdown documents to review.",
    "hub.docs.noCompletedPr":
        "{repo} has no completed pull request — commenting is disabled until one is completed.",
    "hub.docs.loadFailed": "Couldn't load Documents",
    "hub.docs.loading": "Loading Documents",
    "hub.docs.noReposFound.title": "No repositories found",
    "hub.docs.noReposFound.body": "This project doesn't contain any repositories to browse.",
    "hub.docsEmpty.label": "No documents in {repo}",
    "hub.docsEmpty.title": "No documents in this repository",
    "hub.docsEmpty.body":
        "{repo} doesn't contain any Markdown ({ext}) files yet. Pick another repository from the selector above.",
    "hub.repoPicker.label": "Repository",
    "hub.repoPicker.filter": "Filter repositories",
    "hub.repoPicker.loading": "Loading repositories…",
    "hub.repoPicker.noMatch": "No repositories match “{filter}”.",
    "hub.reader.backToFiles": "← Back to Files",
    "hub.reader.openFailed": "Couldn’t open Markdown Review",
    "hub.reader.noCompletedPrThisRepo":
        "This repository has no completed pull request — commenting is disabled until one is completed.",
    "hub.errorBoundary.body":
        "This view hit an unexpected error. Try reloading; if it persists, the issue has been reported automatically.",
    "hub.bootError.heading": "Markdown Review failed to load",
    "hub.sessionNotice.changesSaved":
        "Reconnecting to Azure DevOps — your changes will be saved automatically.",
    "hub.sessionNotice.usuallyFixes":
        "Reconnecting to Azure DevOps — this usually fixes itself within a few minutes.",
} as const satisfies Record<string, MessageValue>;
