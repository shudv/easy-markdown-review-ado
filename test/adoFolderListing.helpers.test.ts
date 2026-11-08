// `listMarkdownLevel` — one OneLevel folder read for the Documents hub tree and
// wiki subpages, driven through a fake Git client (the real one needs the AMD
// SDK bundles).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMarkdownLevel } from "../src/shell/adoFolderListing.helpers";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

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
        getItemText: vi.fn(async (..._args: unknown[]) => {
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
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("listMarkdownLevel", () => {
    it.each([
        { name: "no commit", options: {} },
        { name: "a blank commit", options: { atCommitId: "" } },
    ])(
        "lists nothing (without a client) for a repo with no branch and $name",
        async ({ options }) => {
            const scope = scopeFor(fakeClient({}));
            await expect(
                listMarkdownLevel(scope, { ...repo, defaultBranch: "" }, "/", options),
            ).resolves.toEqual({ files: [], folders: [] });
            expect(scope.git).not.toHaveBeenCalled();
        },
    );

    it("reads at the default branch tip when the commit is blank", async () => {
        const client = fakeClient({ items: [] });
        await listMarkdownLevel(scopeFor(client), repo, "/", { atCommitId: "" });
        expect(client.getItems).toHaveBeenCalledWith(
            "r1",
            "p1",
            "/",
            1,
            false,
            false,
            false,
            false,
            { version: "main", versionType: 0, versionOptions: 0 },
        );
    });

    it("reads one level at the default branch tip, ordered by .order", async () => {
        const client = fakeClient({
            items: wikiItems,
            orderText: "Setup\nIntro",
        });

        const listing = await listMarkdownLevel(scopeFor(client), repo, "/Guides");

        const branchTip = { version: "main", versionType: 0, versionOptions: 0 };

        expect(client.getItems).toHaveBeenCalledWith(
            "r1",
            "p1",
            "/Guides",
            1,
            false,
            false,
            false,
            false,
            branchTip,
        );
        expect(client.getItemText).toHaveBeenCalledWith(
            "r1",
            "/Guides/.order",
            "p1",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            branchTip,
        );
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

        expect(client.getItems).toHaveBeenCalledWith(
            "r1",
            "p1",
            "/",
            1,
            false,
            false,
            false,
            false,
            { version: "c0ffee", versionType: 2, versionOptions: 0 },
        );
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
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "DocumentsHubApp.repository",
                operation: "folder-listing-load",
            }),
        ]);
    });

    it("lists a missing folder as empty when missing is ok", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: notFound() })),
            repo,
            "/Gone",
            { missingOk: true, propagate: true },
        );

        expect(listing).toEqual({ files: [], folders: [] });
        expect(telemetry.current.userFacingErrors()).toEqual([]);
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
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "DocumentsHubApp.repository",
                operation: "wiki-order-load",
            }),
        ]);
    });

    it("doesn't report a .order file that vanished", async () => {
        const listing = await listMarkdownLevel(
            scopeFor(fakeClient({ items: wikiItems, orderText: notFound() })),
            repo,
            "/Guides",
        );

        expect(listing).not.toHaveProperty("order");
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });
});
