// `loadFileDiffs` — the PR tab's per-file diff fetch + sessionStorage cache,
// driven through a fake Git client (the real one needs the AMD SDK bundles).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadFileDiffs } from "../src/shell/adoFileDiffs.helpers";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

const diff = {
  repositoryId: "repo",
  project: "proj",
  baseCommit: "base",
  targetCommit: "target",
};

/** A non-retryable (terminal) REST failure, so `withRetry` gives up at once. */
function notFound(): Error {
  return Object.assign(new Error("not found"), { status: 404 });
}

function fakeClient(opts: { diffs?: unknown; text?: string | Error }): {
  getFileDiffs: ReturnType<typeof vi.fn>;
  getItemText: ReturnType<typeof vi.fn>;
} {
  return {
    getFileDiffs: vi.fn(async () => opts.diffs),
    getItemText: vi.fn(async () => {
      if (opts.text instanceof Error) throw opts.text;
      return opts.text ?? "";
    }),
  };
}

type FakeClient = ReturnType<typeof fakeClient>;

function load(paths: string[], client: FakeClient) {
  const getClient = vi.fn(() => client as never);
  return { getClient, result: loadFileDiffs(diff, paths, getClient) };
}

beforeEach(() => {
  sessionStorage.clear();
  trackUserFacingErrorMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadFileDiffs", () => {
  it("returns {} without touching the client when there are no paths", async () => {
    const { getClient, result } = load([], fakeClient({}));
    await expect(result).resolves.toEqual({});
    expect(getClient).not.toHaveBeenCalled();
  });

  it("fetches diffs, recovers deleted text, and caches the result", async () => {
    const client = fakeClient({
      text: "one\r\ntwo\nthree",
      diffs: [
        { path: "" },
        {
          path: "/a.md",
          lineDiffBlocks: [
            {
              changeType: 2,
              originalLineNumberStart: 2,
              originalLinesCount: 1,
              modifiedLineNumberStart: 2,
            },
          ],
        },
        {
          path: "/b.md",
          lineDiffBlocks: [
            {
              changeType: 1,
              modifiedLineNumberStart: 1,
              modifiedLinesCount: 2,
            },
          ],
        },
      ],
    });
    const { result } = load(["/b.md", "/a.md"], client);
    const out = await result;

    expect(client.getFileDiffs).toHaveBeenCalledWith(
      {
        baseVersionCommit: "base",
        targetVersionCommit: "target",
        fileDiffParams: [
          { originalPath: "/b.md", path: "/b.md" },
          { originalPath: "/a.md", path: "/a.md" },
        ],
      },
      "proj",
      "repo",
    );
    // Only the file with deletions loads its original text, at the base commit.
    expect(client.getItemText).toHaveBeenCalledTimes(1);
    expect(client.getItemText.mock.calls[0]![1]).toBe("/a.md");
    expect(client.getItemText.mock.calls[0]![8]).toEqual({
      version: "base",
      versionType: 2,
      versionOptions: 0,
    });
    expect(out["/a.md"]).toMatchObject({
      linesAdded: 0,
      linesDeleted: 1,
      originalSource: "one\ntwo\nthree",
      ranges: [{ kind: "deleted-marker", deletedContent: "two" }],
    });
    expect(out["/b.md"]).toMatchObject({
      linesAdded: 2,
      linesDeleted: 0,
      originalSource: undefined,
    });

    // The cache key is order-independent and omits the original source.
    const key = Object.keys(sessionStorage).find((k) =>
      k.startsWith("emr:fileDiffs:v6:proj:repo:base:target:"),
    );
    expect(key).toBeDefined();
    const stored = JSON.parse(sessionStorage.getItem(key!)!);
    expect(stored["/a.md"].originalSource).toBeUndefined();
  });

  it("degrades to body-less markers when the original text fails to load", async () => {
    const client = fakeClient({
      text: notFound(),
      diffs: [
        {
          path: "/a.md",
          lineDiffBlocks: [
            {
              changeType: 2,
              originalLineNumberStart: 1,
              originalLinesCount: 1,
            },
          ],
        },
      ],
    });
    const out = await load(["/a.md"], client).result;
    expect(out["/a.md"]!.originalSource).toBeUndefined();
    expect(out["/a.md"]!.ranges[0]).not.toHaveProperty("deletedContent");
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "PrTabApp.diff",
        operation: "original-content-load",
        impact: "degraded",
      }),
    );
  });

  it("treats a missing diff response as no diff data", async () => {
    const out = await load(["/a.md"], fakeClient({ diffs: undefined })).result;
    expect(out).toEqual({});
  });

  it("serves a cached result without any REST call", async () => {
    const first = fakeClient({
      diffs: [{ path: "/a.md", lineDiffBlocks: [] }],
    });
    await load(["/a.md"], first).result;

    const second = fakeClient({});
    const { getClient, result } = load(["/a.md"], second);
    await expect(result).resolves.toEqual({
      "/a.md": { linesAdded: 0, linesDeleted: 0, ranges: [] },
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rehydrates the original source of cached deletion diffs", async () => {
    const blocks = [
      { changeType: 2, originalLineNumberStart: 1, originalLinesCount: 1 },
    ];
    await load(
      ["/a.md", "/b.md"],
      fakeClient({
        text: "gone",
        diffs: [
          { path: "/a.md", lineDiffBlocks: blocks },
          { path: "/b.md", lineDiffBlocks: blocks },
        ],
      }),
    ).result;

    const client = fakeClient({});
    client.getItemText
      .mockResolvedValueOnce("x\ny")
      .mockRejectedValueOnce(notFound());
    const out = await load(["/a.md", "/b.md"], client).result;
    expect(client.getFileDiffs).not.toHaveBeenCalled();
    expect(out["/a.md"]!.originalSource).toBe("x\ny");
    expect(out["/b.md"]!.originalSource).toBeUndefined();
  });

  it("refetches when the cached entry is unreadable", async () => {
    const client = fakeClient({ diffs: [] });
    const { result } = load(["/a.md"], client);
    await result;
    const key = Object.keys(sessionStorage)[0]!;
    sessionStorage.setItem(key, "{not json");

    const again = fakeClient({ diffs: [] });
    await load(["/a.md"], again).result;
    expect(again.getFileDiffs).toHaveBeenCalledTimes(1);
  });

  it("works without sessionStorage", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const client = fakeClient({ diffs: [{ path: "/a.md" }] });
    await expect(load(["/a.md"], client).result).resolves.toEqual({
      "/a.md": {
        linesAdded: 0,
        linesDeleted: 0,
        originalSource: undefined,
        ranges: [],
      },
    });
  });

  it("ignores a failing cache write", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const client = fakeClient({ diffs: [{ path: "/a.md" }] });
    await expect(load(["/a.md"], client).result).resolves.toHaveProperty(
      "/a.md",
    );
  });
});
