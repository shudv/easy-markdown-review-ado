import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType, ReactElement } from "react";
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

/**
 * People suggestions: someone with a photo shows it (standalone, the URL is
 * used directly); someone without one shows their initials.
 */
export const People: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getAllByRole("option").map((row) => row.textContent)).toEqual([
            expect.stringContaining("Shubham Dwivedi"),
            expect.stringContaining("Alex Rivera"),
        ]);

        const img = await waitFor(() => {
            const el = canvas.getByRole("option", { name: /Alex Rivera/ }).querySelector("img");

            expect(el).toBeTruthy();

            return el!;
        });

        expect(img.getAttribute("src")).toBe("https://example.com/alex.png");
        await expect(canvas.getByText("SD")).toBeTruthy();
    },
};

const PHOTO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');

function withResolver(resolve: AvatarImageResolver) {
    return function Decorator(Story: ComponentType): ReactElement {
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
            const el = within(canvasElement)
                .getByRole("option", { name: /Alex Rivera/ })
                .querySelector("img");

            expect(el).toBeTruthy();

            return el!;
        });

        expect(img.getAttribute("src")).toBe(PHOTO);
    },
};

/** Work item suggestions list each item's number and title. */
export const WorkItems: Story = {
    args: { kind: "workitem", query: "fix", suggestions: workItemSuggestions },
    play: async ({ canvasElement }) => {
        const options = within(canvasElement).getAllByRole("option");
        await expect(options).toHaveLength(workItemSuggestions.length);
        await expect(options[0]).toHaveTextContent("412");
        await expect(options[0]).toHaveTextContent("Fix anchor drift on edited lines");
    },
};

/** Pull request suggestions list each PR's number and title. */
export const PullRequests: Story = {
    args: { kind: "pullrequest", query: "story", suggestions: prSuggestions },
    play: async ({ canvasElement }) => {
        const options = within(canvasElement).getAllByRole("option");
        await expect(options).toHaveLength(prSuggestions.length);
        await expect(options[0]).toHaveTextContent("29466");
        await expect(options[0]).toHaveTextContent("Storybook component visual testing");
    },
};

/** While the search runs, the picker says it is searching. */
export const Loading: Story = {
    args: { loading: true, suggestions: [] },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText("Searching…")).toBeTruthy();
    },
};

/** A search with no results says so. */
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
