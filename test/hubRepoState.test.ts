import { describe, expect, it } from "vitest";
import type { GitPullRequest } from "azure-devops-extension-api/Git";

import { withRepoDetails, withRepoDetailsLoaded, withoutKeyPrefix } from "../src/hub/hubRepoState";
import type { DiscoveryState } from "../src/hub/hubDiscovery";
import type { DocRepo } from "../src/shell/types";
import type { FileInfo } from "../src/types";

function repo(id: string, overrides: Partial<DocRepo> = {}): DocRepo {
    return {
        id,
        name: id,
        description: "",
        defaultBranch: "main",
        files: [],
        recentPr: null,
        detailsLoaded: false,
        ...overrides,
    };
}

function discovery(repos: DocRepo[]): DiscoveryState {
    return {
        projectId: "p1",
        projectName: "Project",
        repos,
        initialRepoId: repos[0]?.id ?? "",
        prByRepo: { other: undefined },
        rawRepoById: new Map(),
    };
}

const files: FileInfo[] = [
    { path: "/a.md", changeType: "modified", linesAdded: 0, linesDeleted: 0 },
];

describe("withRepoDetails", () => {
    it("passes a null state through", () => {
        expect(
            withRepoDetails(
                null,
                "r1",
                { files, topLevelFolders: [], recentPr: null, pr: null },
                true,
            ),
        ).toBeNull();
    });

    it("folds the resolved details into the matching repo only", () => {
        const pr = { pullRequestId: 9 } as GitPullRequest;
        const other = repo("r2");

        const next = withRepoDetails(
            discovery([repo("r1"), other]),
            "r1",
            {
                files,
                topLevelFolders: ["/docs"],
                rootOrder: ["a"],
                recentPr: null,
                pr,
            },
            false,
        )!;

        expect(next.repos[0]).toEqual({
            ...repo("r1"),
            files,
            topLevelFolders: ["/docs"],
            rootOrder: ["a"],
            recentPr: null,
            detailsLoaded: true,
            canComment: false,
        });
        expect(next.repos[1]).toBe(other);
        expect(next.prByRepo).toEqual({ other: undefined, r1: pr });
    });

    it("records a missing routing PR as undefined", () => {
        const next = withRepoDetails(
            discovery([repo("r1")]),
            "r1",
            { files, topLevelFolders: [], recentPr: null, pr: null },
            true,
        )!;

        expect("r1" in next.prByRepo).toBe(true);
        expect(next.prByRepo.r1).toBeUndefined();
        expect(next.repos[0]!.canComment).toBe(true);
    });
});

describe("withRepoDetailsLoaded", () => {
    it("passes a null state through", () => {
        expect(withRepoDetailsLoaded(null, "r1", true)).toBeNull();
    });

    it("flips only the matching repo's gate", () => {
        const other = repo("r2");
        const start = discovery([repo("r1", { files }), other]);
        const next = withRepoDetailsLoaded(start, "r1", true)!;
        expect(next.repos[0]).toEqual({
            ...repo("r1", { files }),
            detailsLoaded: true,
        });
        expect(next.repos[1]).toBe(other);
        expect(next.prByRepo).toBe(start.prByRepo);
        expect(withRepoDetailsLoaded(next, "r1", false)!.repos[0]!.detailsLoaded).toBe(false);
    });
});

describe("withoutKeyPrefix", () => {
    it("returns the same object when nothing matches", () => {
        const prev = { "r2\u0000/a.md": 1 };
        expect(withoutKeyPrefix(prev, "r1\u0000")).toBe(prev);
    });

    it("drops every key under the prefix", () => {
        const prev = {
            "r1\u0000/a.md": 1,
            "r1\u0000/b.md": null,
            "r2\u0000/a.md": 3,
        };

        expect(withoutKeyPrefix(prev, "r1\u0000")).toEqual({
            "r2\u0000/a.md": 3,
        });
    });
});
