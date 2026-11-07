import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType, ReactElement } from "react";
import { expect, waitFor, within } from "storybook/test";

import { Avatar, AvatarImageContext } from "./Avatar";
import type { AvatarImageResolver } from "./Avatar";
import { FIXTURE_AUTHORS } from "../../comments/fixtures";
import type { CommentAuthor } from "../../types";

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

/** Without a photo, the avatar shows the author's initials, named in its tooltip. */
async function expectInitials(canvasElement: HTMLElement, author: CommentAuthor): Promise<void> {
    const initials = within(canvasElement).getByText(author.initials);

    await expect(initials).toBeVisible();
    await expect(within(canvasElement).getByTitle(author.displayName)).toContainElement(initials);
}

/** The regular avatar beside a comment. */
export const Medium: Story = {
    play: ({ canvasElement }) => expectInitials(canvasElement, FIXTURE_AUTHORS.shubhd!),
};

/** The compact avatar used in comment rows. */
export const Small: Story = {
    args: { size: "sm" },
    play: ({ canvasElement }) => expectInitials(canvasElement, FIXTURE_AUTHORS.shubhd!),
};

/** Another reviewer gets their own initials (and colour). */
export const Reviewer: Story = {
    args: { author: FIXTURE_AUTHORS.alex! },
    play: ({ canvasElement }) => expectInitials(canvasElement, FIXTURE_AUTHORS.alex!),
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
            const el = canvasElement.querySelector("img");

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
        expect(within(canvasElement).getByText(FIXTURE_AUTHORS.shubhd!.initials)).toBeTruthy();
    },
};

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
            const el = canvasElement.querySelector("img");

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
            expect(within(canvasElement).getByText(FIXTURE_AUTHORS.shubhd!.initials)).toBeTruthy(),
        );
        expect(canvasElement.querySelector("img")).toBeNull();
    },
};
