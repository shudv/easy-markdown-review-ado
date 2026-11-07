// `listMarkdownLevel` — one OneLevel folder read for the Documents hub tree and
// wiki subpages, driven through a fake Git client (the real one needs the AMD
// SDK bundles).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMarkdownLevel } from "../src/shell/adoFolderListing.helpers";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/telemetry")>();

    return {
        ...actual,
        trackUserFacingError: (...args: unknown[]) => trackUserFacingErrorMock(...args),
    };
});

/** Terminal REST failures, so `withRetry` gives up at once. */
const notFound = () => Object.assign(new Error("missing"), { status: 404 });
const failure = () => Object.assign(new Error("boom"), { retryable: false });

const repo = { id: "r1", name: "Docs", defaultBranch: "refs/heads/main" };

function fakeClient(opts: { items?: unknown[] | Error; orderText?: string | Error }) {
    return {
        getItems: vi.fn(async (..._args: unknown[]) => {
            if (opts.items instanceof Error) throw opts.items;

            return opts.items ?? [];
        }),
        getItemText: vi.fn(async () => {
            if (opts.orderText instanceof Error) throw opts.orderText;

            return opts.orderText ?? "";
        }),
    };
}

function scopeFor(client: ReturnType<typeof fakeClient>) {
    return { git: vi.fn(() => client as never), projectId: "p1" };
}

const wikiItems = [
    { path: "/Guides", isFolder: true },
    { path: "/Guides/Setup.md" },
    { path: "/Guides/Intro.md" },
    { path: "/Guides/.order" },
];

beforeEach(() => {
    trackUserFacingErrorMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("listMarkdownLevel", () => {
    it("lists nothing (without a client) for a repo with no branch or commit", async () => {
        const scope = scopeFor(fakeClient({}));
        await expect(
            listMarkdownLevel(scope, { ...repo, defaultBranch: "" }, "/"),
        ).resolves.toEqual({ files: [], folders: [] });
        expect(scope.git).not.toHaveBeenCalled();
    });

    it("reads one level at the default branch tip, ordered by .order", async () => {
        const client = fakeClient({
            items: wikiItems,
            orderText: "Setup\nIntro",
        });

        const listing = await listMarkdownLevel(scopeFor(client), repo, "/Guides");

        expect(client.getItems).toHaveBeenCalledWith(
            "r1",
            "p1",
            "/Guides",
            1,
            false,
            false,
            false,
            false,
            { version: "main", versionType: 0, versionOptions: 0 },
        );
        expect(client.getItemText.mock.calls[0]!.slice(0, 3)).toEqual([
            "r1",
            "/Guides/.order",
            "p1",
        ]);
        expect(listing).toEqual({
            files: [
                expect.objectContaining({ path: "/Guides/Intro.md" }),
                expect.objectContaining({ path: "/Guides/Setup.md" }),
            ],
            folders: [],
            order: ["Setup", "Intro"],
        });
    });

    it("pins the read to a commit when one is given", async () => {
        const client = fakeClient({ items: [{ path: "/a.md" }] });

        const listing = await listMarkdownLevel(
            scopeFor(client),
            { ...repo, defaultBranch: "" },
            "/",
            { atCommitId: "c0ffee" },
        );

        expect(client.getItems.mock.calls[0]![8]).toEqual({
            version: "c0ffee",
            versionType: 2,
            versionOptions: 0,
        });
        expect(client.getItemText).not.toHaveBeenCalled();
        expect(listing).not.toHaveProperty("order");
    });

    it("degrades a failed read to an empty listing and reports it", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: failure() })),
            repo,
            "/",
        );

        expect(listing).toEqual({ files: [], folders: [] });
        expect(trackUserFacingErrorMock).toHaveBeenCalledWith(
            expect.objectContaining({ operation: "folder-listing-load" }),
        );
    });

    it("lists a missing folder as empty when missing is ok", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: notFound() })),
            repo,
            "/Gone",
            { missingOk: true, propagate: true },
        );

        expect(listing).toEqual({ files: [], folders: [] });
        expect(trackUserFacingErrorMock).not.toHaveBeenCalled();
    });

    it("rethrows other failures when the caller propagates", async () => {
        const err = failure();
        await expect(
            listMarkdownLevel(scopeFor(fakeClient({ items: err })), repo, "/", {
                propagate: true,
            }),
        ).rejects.toBe(err);
    });

    it("still lists alphabetically when the .order file can't be read", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: wikiItems, orderText: failure() })),
            repo,
            "/Guides",
        );

        expect(listing).not.toHaveProperty("order");
        expect(listing.files.map((f) => f.path)).toEqual(["/Guides/Intro.md", "/Guides/Setup.md"]);
        expect(trackUserFacingErrorMock).toHaveBeenCalledWith(
            expect.objectContaining({ operation: "wiki-order-load" }),
        );
    });

    it("doesn't report a .order file that vanished", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: wikiItems, orderText: notFound() })),
            repo,
            "/Guides",
        );

        expect(listing).not.toHaveProperty("order");
        expect(trackUserFacingErrorMock).not.toHaveBeenCalled();
    });
});
