// Routing a document's comments to PRs in its history (`routingPrForDoc`,
// `mostRecentRoutingPr`) and loading its review-history stops
// (`docPrHistory`), driven through a fake Git client (the real one needs the
// AMD SDK bundles).

import type { GitPullRequest, GitRepository } from "azure-devops-extension-api/Git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    docPrHistory,
    mostRecentRoutingPr,
    routingPrForDoc,
} from "../src/shell/adoPrRouting.helpers";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

/** Terminal REST failures, so `withRetry` gives up at once. */
const notFound = () => Object.assign(new Error("missing"), { status: 404 });
const failure = () => Object.assign(new Error("boom"), { retryable: false });

const repo = {
    id: "r1",
    name: "Docs",
    defaultBranch: "refs/heads/main",
    webUrl: "https://dev.azure.com/o/p/_git/Docs",
} as GitRepository;

const noBranch = { ...repo, defaultBranch: "" } as GitRepository;

function pr(id: number, closed: string, status = 3): GitPullRequest {
    return {
        pullRequestId: id,
        status,
        title: `PR ${id}`,
        closedDate: new Date(closed),
        lastMergeCommit: { commitId: `m${id}` },
    } as unknown as GitPullRequest;
}

type Reply<T> = T | Error;

const answer = async <T>(r: Reply<T>): Promise<T> => {
    if (r instanceof Error) throw r;

    return r;
};

function fakeClient(opts: {
    prs?: Reply<unknown[]>;
    commits?: Reply<{ commitId?: string }[]>;
    query?: Reply<{ results?: Record<string, GitPullRequest[]>[] }>;
}) {
    return {
        getPullRequests: vi.fn((..._args: unknown[]) => answer(opts.prs ?? [])),
        getCommits: vi.fn((..._args: unknown[]) => answer(opts.commits ?? [])),
        getPullRequestQuery: vi.fn((..._args: unknown[]) => answer(opts.query ?? {})),
    };
}

function scopeFor(client: ReturnType<typeof fakeClient>) {
    return { git: vi.fn(() => client as never), projectId: "p1" };
}

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("mostRecentRoutingPr", () => {
    it("is null (without a client) for a repo with no default branch", async () => {
        const scope = scopeFor(fakeClient({}));
        await expect(mostRecentRoutingPr(scope, noBranch)).resolves.toBeNull();
        expect(scope.git).not.toHaveBeenCalled();
    });

    it("picks the most recent completed PR into the default branch", async () => {
        const client = fakeClient({
            prs: [pr(1, "2024-01-01"), pr(2, "2024-03-01"), pr(3, "2024-05-01", 1)],
        });

        const found = await mostRecentRoutingPr(scopeFor(client), repo);
        expect(found?.pullRequestId).toBe(2);
        expect(client.getPullRequests).toHaveBeenCalledWith(
            "r1",
            { targetRefName: "refs/heads/main", status: 3 },
            "p1",
            undefined,
            0,
            10,
        );
    });

    it("degrades to no PR when the PRs can't be listed", async () => {
        const found = await mostRecentRoutingPr(scopeFor(fakeClient({ prs: failure() })), repo);

        expect(found).toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "DocumentsHubApp.repository",
                operation: "repository-pr-routing",
                error: expect.objectContaining({ message: "boom" }),
            }),
        ]);
    });

    it("degrades to no PR and reports it when the PR list is malformed", async () => {
        const found = await mostRecentRoutingPr(scopeFor(fakeClient({ prs: [null] })), repo);

        expect(found).toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "DocumentsHubApp.repository",
                operation: "repository-pr-routing",
            }),
        ]);
    });
});

describe("routingPrForDoc", () => {
    it("is null (without a client) for a repo with no default branch", async () => {
        const scope = scopeFor(fakeClient({}));
        await expect(routingPrForDoc(scope, noBranch, "/a.md")).resolves.toBeNull();
        expect(scope.git).not.toHaveBeenCalled();
    });

    it("routes to the PR that merged the file's last commit", async () => {
        const merged = pr(7, "2024-02-01");

        const client = fakeClient({
            commits: [{ commitId: "c1" }],
            query: { results: [{ c1: [merged] }] },
        });

        await expect(routingPrForDoc(scopeFor(client), repo, "/docs/a.md/")).resolves.toBe(merged);
        expect(client.getCommits).toHaveBeenCalledWith(
            "r1",
            {
                itemPath: "/docs/a.md",
                itemVersion: {
                    version: "main",
                    versionType: 0,
                    versionOptions: 0,
                },
                $top: 1,
            },
            "p1",
        );
        expect(client.getPullRequestQuery).toHaveBeenCalledWith(
            { queries: [{ type: 1, items: ["c1"] }] },
            "r1",
            "p1",
        );
        expect(client.getPullRequests).not.toHaveBeenCalled();
    });

    it("falls back to the repo's latest PR when the commit has no PR", async () => {
        const latest = pr(9, "2024-04-01");

        const client = fakeClient({
            commits: [{ commitId: "c1" }],
            query: { results: [{}] },
            prs: [latest],
        });

        await expect(routingPrForDoc(scopeFor(client), repo, "/a.md")).resolves.toEqual(latest);
    });

    it("falls back without a PR query when the file has no commits", async () => {
        const client = fakeClient({ commits: [], prs: [] });
        await expect(routingPrForDoc(scopeFor(client), repo, "/a.md")).resolves.toBeNull();
        expect(client.getPullRequestQuery).not.toHaveBeenCalled();
    });

    it("falls back quietly when the file is gone from the branch", async () => {
        const client = fakeClient({ commits: notFound() });
        await routingPrForDoc(scopeFor(client), repo, "/a.md");
        expect(client.getPullRequests).toHaveBeenCalled();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it.each([
        {
            name: "the file's commits can't be listed",
            failing: { commits: failure() },
            operation: "document-routing-commit-load",
        },
        {
            name: "the PR lookup for its last commit fails",
            failing: { commits: [{ commitId: "c1" }], query: failure() },
            operation: "document-pr-routing",
        },
    ])(
        "reports it and falls back to the repo's latest PR when $name",
        async ({ failing, operation }) => {
            const latest = pr(9, "2024-04-01");
            const client = fakeClient({ ...failing, prs: [latest] });

            await expect(routingPrForDoc(scopeFor(client), repo, "/a.md")).resolves.toEqual(latest);
            expect(telemetry.current.userFacingErrors()).toEqual([
                expect.objectContaining({ source: "DocumentsHubApp.comments", operation }),
            ]);
        },
    );
});

describe("docPrHistory", () => {
    it("is empty (without a client) for a repo with no default branch", async () => {
        const scope = scopeFor(fakeClient({}));
        await expect(docPrHistory(scope, noBranch, "/a.md")).resolves.toEqual([]);
        expect(scope.git).not.toHaveBeenCalled();
    });

    it("maps a page of the file's commits to its completed PRs", async () => {
        const client = fakeClient({
            commits: [{ commitId: "c2" }, { commitId: "c1" }],
            query: {
                results: [{ c2: [pr(2, "2024-03-01")], c1: [pr(1, "2024-01-01")] }],
            },
        });

        const refs = await docPrHistory(scopeFor(client), repo, "/a.md", {
            top: 2,
            skip: 4,
        });

        expect(refs.map((r) => [r.prId, r.commitId, r.url])).toEqual([
            [2, "m2", "https://dev.azure.com/o/p/_git/Docs/pullrequest/2"],
            [1, "m1", "https://dev.azure.com/o/p/_git/Docs/pullrequest/1"],
        ]);
        expect(client.getCommits).toHaveBeenCalledWith(
            "r1",
            expect.objectContaining({ itemPath: "/a.md", $top: 2, $skip: 4 }),
            "p1",
        );
        expect(client.getPullRequestQuery).toHaveBeenCalledWith(
            { queries: [{ type: 1, items: ["c2", "c1"] }] },
            "r1",
            "p1",
        );
    });

    it("is empty without a PR query when the file has no commits", async () => {
        const client = fakeClient({ commits: [] });
        await expect(docPrHistory(scopeFor(client), repo, "/a.md")).resolves.toEqual([]);
        expect(client.getPullRequestQuery).not.toHaveBeenCalled();
    });

    it("reads the first page of 30 commits by default", async () => {
        const client = fakeClient({ commits: [] });
        await docPrHistory(scopeFor(client), repo, "/a.md");
        expect(client.getCommits).toHaveBeenCalledWith(
            "r1",
            expect.objectContaining({ $top: 30, $skip: 0 }),
            "p1",
        );
    });

    it("is empty when the file is gone from the branch, quietly", async () => {
        await expect(
            docPrHistory(scopeFor(fakeClient({ commits: notFound() })), repo, "/a"),
        ).resolves.toEqual([]);
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it.each([
        {
            name: "the file's commits can't be listed",
            failing: { commits: failure() },
            operation: "history-commit-load",
        },
        {
            name: "the PR lookup for its commits fails",
            failing: { commits: [{ commitId: "c1" }], query: failure() },
            operation: "history-pr-load",
        },
    ])("shows an empty history and reports it when $name", async ({ failing, operation }) => {
        await expect(docPrHistory(scopeFor(fakeClient(failing)), repo, "/a")).resolves.toEqual([]);
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({ source: "Shell.history", operation }),
        ]);
    });
});
