import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Avatar, AvatarImageContext } from "./Avatar";
import type { AvatarImageResolver } from "./Avatar";
import { FIXTURE_AUTHORS } from "../../comments/fixtures";

const meta = {
  title: "Components/Avatar",
  component: Avatar,
  args: {
    author: FIXTURE_AUTHORS.shubhd!,
    size: "md",
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Medium: Story = {};

export const Small: Story = {
  args: { size: "sm" },
};

export const Reviewer: Story = {
  args: { author: FIXTURE_AUTHORS.alex! },
};

// A 1x1 SVG data URL — loads without network, so the photo (not the initials
// fallback) is shown.
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='%234c8'/></svg>",
  );

/**
 * No resolver in context (Storybook / standalone): `avatarUrl` is rendered
 * directly as the `<img src>`.
 */
export const Photo: Story = {
  args: {
    author: { ...FIXTURE_AUTHORS.shubhd!, avatarUrl: PHOTO },
  },
  play: async ({ canvasElement }) => {
    const img = await waitFor(() => {
      const el =
        canvasElement.querySelector<HTMLImageElement>("img.emr-avatar-img");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(img.getAttribute("src")).toBe(PHOTO);
  },
};

/** A broken photo URL falls back to the initials avatar via the `onError` hook. */
export const PhotoBroken: Story = {
  args: {
    author: {
      ...FIXTURE_AUTHORS.shubhd!,
      avatarUrl: "/__emr_nonexistent_avatar__.png",
    },
  },
  play: async ({ canvasElement }) => {
    // The img 404s, fires onError, and we swap back to initials.
    await waitFor(() => expect(canvasElement.querySelector("img")).toBeNull(), {
      timeout: 5000,
    });
    expect(
      within(canvasElement).getByText(FIXTURE_AUTHORS.shubhd!.initials),
    ).toBeTruthy();
  },
};

function withResolver(resolve: AvatarImageResolver) {
  return function Decorator(Story: React.ComponentType): React.ReactElement {
    return (
      <AvatarImageContext.Provider value={resolve}>
        <Story />
      </AvatarImageContext.Provider>
    );
  };
}

/**
 * Real host: a resolver fetches the photo (with auth) and returns a local URL
 * the `<img>` adopts. Mirrors the cross-origin iframe path.
 */
export const Resolved: Story = {
  args: {
    author: { ...FIXTURE_AUTHORS.shubhd!, avatarUrl: "https://ado/photo" },
  },
  decorators: [withResolver(async () => PHOTO)],
  play: async ({ canvasElement }) => {
    const img = await waitFor(() => {
      const el =
        canvasElement.querySelector<HTMLImageElement>("img.emr-avatar-img");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(img.getAttribute("src")).toBe(PHOTO);
  },
};

/** Resolver can't load the photo (auth fail): falls back to initials. */
export const ResolvedMissing: Story = {
  args: {
    author: { ...FIXTURE_AUTHORS.shubhd!, avatarUrl: "https://ado/photo" },
  },
  decorators: [withResolver(async () => undefined)],
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getByText(FIXTURE_AUTHORS.shubhd!.initials),
      ).toBeTruthy(),
    );
    expect(canvasElement.querySelector("img")).toBeNull();
  },
};
