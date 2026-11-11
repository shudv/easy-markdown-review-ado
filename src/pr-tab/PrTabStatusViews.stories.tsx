import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
    BootErrorView,
    DEAD_WINDOW_ISSUE_URL,
    NoMarkdownFilesView,
    PrDocNavTitle,
    SessionRefreshingView,
} from "./PrTabStatusViews";
import { PrTabLoadingView } from "./useSlowBoot";

// The PR tab's full-page states before a document renders: the ADO token dead
// window at boot (three stages), a boot failure, and a PR with no Markdown.

const frame = (Story: ComponentType) => (
    <div className="emr-app" style={{ width: 720, minHeight: 320 }}>
        <Story />
    </div>
);

const meta = {
    title: "Components/PrTabStatusViews",
    component: SessionRefreshingView,
    decorators: [frame],
    args: { onReload: fn() },
} satisfies Meta<typeof SessionRefreshingView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** What the reconnecting page offers the user: a reload button and/or the explainer link. */
function reconnectOffers(canvasElement: HTMLElement) {
    const canvas = within(canvasElement);

    return {
        reload: canvas.queryByRole("button", { name: "Reload page" }) !== null,
        explainer:
            canvas.queryByRole("link", { name: /Why this happens/ })?.getAttribute("href") ?? null,
    };
}

/** Stage 1 — the window was hit at boot; the automatic host reload is about to run. */
export const ReconnectingAutoReload: Story = {
    args: { autoReload: true },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
            "This only takes a moment.",
        );
        await expect(reconnectOffers(canvasElement)).toEqual({ reload: false, explainer: null });
    },
};

/** Stage 2 — no automatic reload has happened (e.g. it was refused): offer one. */
export const ReconnectingManualReload: Story = {
    args: { autoReload: false },
    play: async ({ args, canvasElement }) => {
        await expect(reconnectOffers(canvasElement)).toEqual({
            reload: true,
            explainer: DEAD_WINDOW_ISSUE_URL,
        });
        await userEvent.click(within(canvasElement).getByRole("button", { name: "Reload page" }));
        await expect(args.onReload).toHaveBeenCalledOnce();
    },
};

/**
 * Stage 3 — the window survived the automatic reload, so the host is serving
 * the same dead token across reloads: explain, give the ETA, offer no reload.
 */
export const ReconnectingReloadWontHelp: Story = {
    args: {
        autoReload: false,
        reloadTried: true,
        recoverAtMs: Date.now() + 4 * 60_000,
    },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
            "so reloading won't help. It will continue by itself within about 4 minutes.",
        );
        await expect(reconnectOffers(canvasElement)).toEqual({
            reload: false,
            explainer: DEAD_WINDOW_ISSUE_URL,
        });
    },
};

const retry = fn();

/** A boot failure that isn't the dead window shows the error and lets the user retry. */
export const BootError: StoryObj<typeof BootErrorView> = {
    render: () => (
        <BootErrorView
            error="TF401019: The Git repository with name or identifier e8fad09e does not exist or you do not have permissions for the operation you are attempting."
            onRetry={retry}
        />
    ),
    beforeEach: () => {
        retry.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
        await expect(canvas.getByText(/^TF401019: The Git repository/)).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
        await expect(retry).toHaveBeenCalledOnce();
    },
};

const browseDocuments = fn();

/**
 * A PR whose changes include no Markdown files: rather than a dead end, the
 * page offers the repository's documents.
 */
export const NoMarkdownFiles: StoryObj<typeof NoMarkdownFilesView> = {
    render: () => <NoMarkdownFilesView onBrowseDocuments={browseDocuments} />,
    beforeEach: () => {
        browseDocuments.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(
            canvas.getByRole("heading", { name: "No Markdown files changed in this PR" }),
        ).toBeVisible();
        await userEvent.click(canvas.getByRole("button", { name: "Browse repository documents" }));
        await expect(browseDocuments).toHaveBeenCalledOnce();
    },
};

const openDocuments = fn();

/** The PR tab's file-list title, with its way into the Documents hub. */
export const DocNavTitleWithDocumentsLink: StoryObj<typeof PrDocNavTitle> = {
    render: () => (
        <div className="emr-docnav-header" style={{ width: 260 }}>
            <PrDocNavTitle onOpenDocuments={openDocuments} />
        </div>
    ),
    beforeEach: () => {
        openDocuments.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Documents")).toBeVisible();
        await userEvent.click(
            canvas.getByRole("button", {
                name: "Open all of this repository's documents in a new tab",
            }),
        );
        await expect(openDocuments).toHaveBeenCalledOnce();
    },
};

const retrySlowBoot = fn();

/**
 * Azure DevOps is slow to return the pull request (production: one project's
 * lookup took 30 s+): the loading page keeps waiting and offers a retry in the
 * status bar instead of failing.
 */
export const SlowBoot: StoryObj<typeof PrTabLoadingView> = {
    render: () => <PrTabLoadingView slow onRetry={retrySlowBoot} />,
    beforeEach: () => {
        retrySlowBoot.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByRole("status")).toHaveTextContent(
            "Azure DevOps is slow to respond — still loading…",
        );
        await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
        await expect(retrySlowBoot).toHaveBeenCalledOnce();
    },
};
