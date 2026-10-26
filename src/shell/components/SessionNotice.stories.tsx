import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { AdoSessionMonitor } from "../adoSession";
import { SessionRefreshingError } from "../adoAuthToken";
import { SessionNotice } from "./SessionNotice";

/** A monitor already in a dead-window spell, optionally with held writes. */
function refreshingMonitor(opts: {
  reloadHost?: () => void;
  heldWrites?: number;
}): AdoSessionMonitor {
  const monitor = new AdoSessionMonitor();
  if (opts.reloadHost) monitor.configure({ reloadHost: opts.reloadHost });
  monitor.report(
    new SessionRefreshingError("refreshing", Date.now() + 5 * 60_000),
    "poll",
  );
  for (let i = 0; i < (opts.heldWrites ?? 0); i++) {
    void monitor
      .holdWrite(() =>
        Promise.reject(
          new SessionRefreshingError("refreshing", Date.now() + 5 * 60_000),
        ),
      )
      .catch(() => {});
  }
  return monitor;
}

const meta = {
  title: "Components/SessionNotice",
  component: SessionNotice,
  decorators: [
    (Story: React.ComponentType) => (
      <div className="emr-app" style={{ width: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing renders while the session is live. */
export const Live: Story = {
  args: { monitor: new AdoSessionMonitor() },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".emr-toast")).toBeNull();
  },
};

const reloadSpy = fn();

/** Reconnecting: says it clears by itself; "Reload page" is a quiet link. */
export const Reconnecting: Story = {
  args: { monitor: refreshingMonitor({ reloadHost: reloadSpy }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status").textContent).toBe(
      "Reconnecting to Azure DevOps — this usually fixes itself within a few minutes.Reload page",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Reload page" }));
    await expect(reloadSpy).toHaveBeenCalled();
    // A reload is only requested; the notice stays until the session is back.
    await expect(canvas.getByRole("status")).toBeTruthy();
    args.monitor!.noteSuccess(Date.now());
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-toast")).toBeNull(),
    );
  },
};

/** With a change waiting: reassures it will be saved; hides the reload link, which would drop it. */
export const ChangeWaiting: Story = {
  args: { monitor: refreshingMonitor({ heldWrites: 1, reloadHost: fn() }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole("status").textContent).toBe(
        "Reconnecting to Azure DevOps — your changes will be saved automatically.",
      ),
    );
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** An open inline edit (not kept as a draft) hides the reload link too. */
export const UnsavedEditOpen: Story = {
  args: {
    monitor: refreshingMonitor({ reloadHost: fn() }),
    reloadAllowed: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status").textContent).toContain(
      "this usually fixes itself",
    );
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** Without a wired host reload there is no reload link at all. */
export const NoReloadAvailable: Story = {
  args: { monitor: refreshingMonitor({}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toBeTruthy();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** Defaults to the app-wide monitor, which is live in the story harness. */
export const AppWideMonitor: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".emr-toast")).toBeNull();
  },
};
