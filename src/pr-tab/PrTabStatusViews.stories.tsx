import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
    BootErrorView,
    DEAD_WINDOW_ISSUE_URL,
    NoMarkdownFilesView,
    SessionRefreshingView,
} from "./PrTabStatusViews";

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

/** Stage 1 — the window was hit at boot; the automatic host reload is about to run. */
export const ReconnectingAutoReload: Story = {
    args: { autoReload: true },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("This only takes a moment.")).toBeTruthy();
        await expect(canvas.queryByRole("button")).toBeNull();
    },
};

/** Stage 2 — no automatic reload has happened (e.g. it was refused): offer one. */
export const ReconnectingManualReload: Story = {
    args: { autoReload: false },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Reload page" }));
        await expect(args.onReload).toHaveBeenCalledOnce();
        await expect(
            canvas.getByRole("link", { name: /Why this happens/ }).getAttribute("href"),
        ).toBe(DEAD_WINDOW_ISSUE_URL);
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
        const canvas = within(canvasElement);
        await expect(canvas.getByRole("status").textContent).toContain(
            "so reloading won't help. It will continue by itself within about 4 minutes.",
        );
        await expect(canvas.queryByRole("button")).toBeNull();
        await expect(canvas.getByRole("link", { name: /Why this happens/ })).toBeTruthy();
    },
};

/** A boot failure that isn't the dead window. */
export const BootError: StoryObj<typeof BootErrorView> = {
    render: () => (
        <BootErrorView
            error="TF401019: The Git repository with name or identifier e8fad09e does not exist or you do not have permissions for the operation you are attempting."
            onRetry={fn()}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Something went wrong")).toBeTruthy();
        await expect(canvas.getByRole("button", { name: "Try again" })).toBeTruthy();
    },
};

/** A PR whose changes include no Markdown files. */
export const NoMarkdownFiles: StoryObj<typeof NoMarkdownFilesView> = {
    render: () => <NoMarkdownFilesView />,
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText("No Markdown files changed in this PR"),
        ).toBeTruthy();
    },
};
