import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { MentionSuggestion } from "../../comments/mentions";
import { MentionPicker } from "./MentionPicker";
import { AvatarImageContext, type AvatarImageResolver } from "./Avatar";

const userSuggestions: MentionSuggestion[] = [
  {
    kind: "user",
    id: "u-shubhd",
    displayName: "Shubham Dwivedi",
    initials: "SD",
    secondary: "shubhd@example.com",
  },
  {
    kind: "user",
    id: "u-alex",
    displayName: "Alex Rivera",
    initials: "AR",
    avatarUrl: "https://example.com/alex.png",
  },
];

const workItemSuggestions: MentionSuggestion[] = [
  {
    kind: "workitem",
    id: "412",
    workItemType: "Bug",
    title: "Fix anchor drift on edited lines",
    state: "Active",
    stateColor: "#cc293d",
  },
  {
    kind: "workitem",
    id: "98",
    workItemType: "User Story",
    title: "Inline editing for design docs",
    state: "In Progress",
  },
  {
    kind: "workitem",
    id: "7",
    workItemType: "Task",
    title: "Wire up coverage gate",
    state: "To Do",
  },
  {
    kind: "workitem",
    id: "3",
    workItemType: "Feature",
    title: "Storybook visual testing",
    state: "Active",
  },
  {
    kind: "workitem",
    id: "1",
    workItemType: "Epic",
    title: "Review experience overhaul",
    state: "Active",
  },
  {
    kind: "workitem",
    id: "55",
    workItemType: "Issue",
    title: "Investigate flaky render",
    state: "New",
  },
];

const prSuggestions: MentionSuggestion[] = [
  {
    kind: "pullrequest",
    id: "29466",
    title: "Storybook component visual testing",
    status: "active",
    repository: "EasyMarkdownReview",
  },
  {
    kind: "pullrequest",
    id: "118",
    title: "Theme sync groundwork",
    status: "completed",
  },
  {
    kind: "pullrequest",
    id: "77",
    title: "Abandoned spike",
    status: "abandoned",
  },
];

const meta = {
  title: "Components/MentionPicker",
  component: MentionPicker,
  args: {
    kind: "user",
    query: "sh",
    suggestions: userSuggestions,
    loading: false,
    top: 40,
    left: 40,
    selectedIndex: 0,
    onSelectedIndexChange: fn(),
    onSelect: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof MentionPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const People: Story = {
  play: async ({ canvasElement }) => {
    // A user with a photo renders an <img>; one without falls back to initials.
    // (No resolver in context → the URL is used directly, like standalone.)
    const img = await waitFor(() => {
      const el =
        canvasElement.querySelector<HTMLImageElement>("img.emr-avatar-img");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(img.getAttribute("src")).toBe("https://example.com/alex.png");
    await expect(within(canvasElement).getByText("SD")).toBeTruthy();
  },
};

const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  );

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
 * Real host: ADO photo URLs need auth, so a resolver fetches them and returns a
 * local URL the row's <img> adopts. This is the path that was previously broken
 * (the picker used the raw cross-origin URL as a CSS background and it failed).
 */
export const PeopleWithResolvedPhotos: Story = {
  args: {
    suggestions: [
      {
        kind: "user",
        id: "u-alex",
        displayName: "Alex Rivera",
        initials: "AR",
        avatarUrl: "https://ado/photo",
      },
    ],
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

export const WorkItems: Story = {
  args: { kind: "workitem", query: "fix", suggestions: workItemSuggestions },
};

export const PullRequests: Story = {
  args: { kind: "pullrequest", query: "story", suggestions: prSuggestions },
};

export const Loading: Story = {
  args: { loading: true, suggestions: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Searching…")).toBeTruthy();
  },
};

export const NoMatches: Story = {
  args: { suggestions: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No matches")).toBeTruthy();
  },
};

/** Hovering a row reports the new index; clicking selects it. */
export const HoverAndSelect: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole("option");
    await userEvent.hover(rows[1]!);
    await expect(args.onSelectedIndexChange).toHaveBeenCalledWith(1);
    await userEvent.click(rows[1]!);
    await expect(args.onSelect).toHaveBeenCalledTimes(1);
  },
};

/** A mousedown outside the popover cancels it. */
export const CancelsOnOutsideClick: Story = {
  play: async ({ args }) => {
    await userEvent.click(document.body);
    await expect(args.onCancel).toHaveBeenCalled();
  },
};
