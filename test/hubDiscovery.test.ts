// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepository } from "azure-devops-extension-api/Git";

import type { DocRepo } from "../src/shell/types";

const mocks = vi.hoisted(() => ({
    resolveCurrentProject: vi.fn(),
    fetchRepoPage: vi.fn(),
    fetchRepoById: vi.fn(),
    readRouteParams: vi.fn(),
}));

vi.mock("../src/shell/adoClients", () => ({
    resolveCurrentProject: mocks.resolveCurrentProject,
}));
vi.mock("../src/shell/adoGitData", () => ({
    fetchRepoPage: mocks.fetchRepoPage,
    fetchRepoById: mocks.fetchRepoById,
}));
vi.mock("../src/hub/hubNavigation", () => ({
    readRouteParams: mocks.readRouteParams,
}));

import { REPO_PAGE_SIZE, discoverHub } from "../src/hub/hubDiscovery";
import { readLastPath, readLastRepo, writeLastPath, writeLastRepo } from "../src/hub/lastVisited";
import { getTelemetryContext } from "../src/telemetry";
import { recordTelemetryEachTest } from "./telemetrySink";

recordTelemetryEachTest();

function repo(id: string): DocRepo {
    return {
        id,
        name: id,
        description: "",
        defaultBranch: "main",
        files: [],
        recentPr: null,
        detailsLoaded: false,
    };
}

function raw(id: string): GitRepository {
    return { id, name: id } as GitRepository;
}

function page(ids: string[], continuationToken: string | null = null) {
    return {
        repos: ids.map(repo),
        rawRepoById: new Map(ids.map((id) => [id, raw(id)])),
        continuationToken,
    };
}

const project = { id: "p1", name: "Project" };

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.resolveCurrentProject.mockResolvedValue(project);
    mocks.readRouteParams.mockResolvedValue({});
});

describe("discoverHub", () => {
    it("opens the first repo with an unfiltered picker view", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page(["a", "b"], "tok"));

        const { discovery, picker } = await discoverHub(vi.fn());

        expect(mocks.fetchRepoPage).toHaveBeenCalledWith("p1", {
            top: REPO_PAGE_SIZE,
        });
        expect(discovery).toEqual({
            projectId: "p1",
            projectName: "Project",
            repos: [repo("a"), repo("b")],
            prByRepo: {},
            rawRepoById: new Map([
                ["a", raw("a")],
                ["b", raw("b")],
            ]),
            initialRepoId: "a",
            initialSelectedPath: undefined,
            initialActiveThreadId: undefined,
            initialAnchor: undefined,
            initialTextFragment: undefined,
        });
        expect(picker).toEqual({
            viewIds: ["a", "b"],
            filter: "",
            token: "tok",
            hasMore: true,
            loading: false,
        });
        expect(readLastRepo("p1")).toBe("a");
        expect(readLastPath("p1", "a")).toBeUndefined();
        expect(mocks.fetchRepoById).not.toHaveBeenCalled();
    });

    it("doesn't look up a blank repo remembered from an empty project", async () => {
        writeLastRepo("p1", "");
        mocks.fetchRepoPage.mockResolvedValue(page(["a"]));

        const { discovery } = await discoverHub(vi.fn());

        expect(mocks.fetchRepoById).not.toHaveBeenCalled();
        expect(discovery.initialRepoId).toBe("a");
    });

    it("opens a deep-linked document nested in folders", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page(["a"]));
        mocks.readRouteParams.mockResolvedValue({ path: "docs/guide/x.md" });

        const { discovery } = await discoverHub(vi.fn());

        expect(discovery.initialSelectedPath).toBe("/docs/guide/x.md");
    });

    it("tags telemetry with the current project", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page(["a"]));
        await discoverHub(vi.fn());
        expect(getTelemetryContext().projectId).toBe("p1");
    });

    it("resolves an empty project to no repo", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page([]));
        const { discovery, picker } = await discoverHub(vi.fn());
        expect(discovery.initialRepoId).toBe("");
        expect(picker.hasMore).toBe(false);
    });

    it("honours a deep link to a repo on page one with its targets", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page(["a", "b"]));
        mocks.readRouteParams.mockResolvedValue({
            repo: "b",
            path: "//docs/x.md",
            comment: "t1",
            anchor: "#goals",
            text: "hello",
        });

        const { discovery } = await discoverHub(vi.fn());

        expect(mocks.fetchRepoById).not.toHaveBeenCalled();
        expect(discovery.initialRepoId).toBe("b");
        expect(discovery.initialSelectedPath).toBe("/docs/x.md");
        expect(discovery.initialActiveThreadId).toBe("t1");
        expect(discovery.initialAnchor).toBe("goals");
        expect(discovery.initialTextFragment).toBe("hello");
        expect(readLastRepo("p1")).toBe("b");
        expect(readLastPath("p1", "b")).toBe("/docs/x.md");
    });

    it("reopens the last-visited repo + document, dropping stray targets", async () => {
        writeLastRepo("p1", "z");
        writeLastPath("p1", "z", "/last.md");
        mocks.fetchRepoPage.mockResolvedValue(page(["a"]));
        mocks.fetchRepoById.mockResolvedValue({
            repo: repo("z"),
            raw: raw("z"),
        });
        mocks.readRouteParams.mockResolvedValue({ anchor: "goals", text: "t" });

        const { discovery, picker } = await discoverHub(vi.fn());

        expect(mocks.fetchRepoById).toHaveBeenCalledWith("p1", "z");
        expect(discovery.initialRepoId).toBe("z");
        expect(discovery.repos.map((r) => r.id)).toEqual(["z", "a"]);
        expect(discovery.rawRepoById.get("z")).toEqual(raw("z"));
        expect(discovery.initialSelectedPath).toBe("/last.md");
        expect(discovery.initialAnchor).toBeUndefined();
        expect(discovery.initialTextFragment).toBeUndefined();
        expect(picker.viewIds).toEqual(["z", "a"]);
    });

    it("falls back to page one when the preferred repo is gone", async () => {
        mocks.fetchRepoPage.mockResolvedValue(page(["a"]));
        mocks.fetchRepoById.mockResolvedValue(undefined);
        mocks.readRouteParams.mockResolvedValue({ repo: "gone" });

        const { discovery } = await discoverHub(vi.fn());

        expect(discovery.initialRepoId).toBe("a");
        expect(discovery.repos.map((r) => r.id)).toEqual(["a"]);
    });
});
