import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { FileInfo } from "../../types";
import type { FileSearchOutcome } from "../almSearch";
import { DocNav } from "./DocNav";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SELECTED = "docs/api/guide.md";

const FILES: FileInfo[] = [
  {
    path: "docs/api/guide.md",
    changeType: "modified",
    linesAdded: 3,
    linesDeleted: 4,
  },
  {
    path: "docs/api/internal.md",
    changeType: "added",
    linesAdded: 10,
    linesDeleted: 0,
  },
  { path: "README.md", changeType: "modified", linesAdded: 0, linesDeleted: 0 },
  {
    path: "old-name.md",
    changeType: "renamed",
    renamedFrom: "ancient.md",
    linesAdded: 1,
    linesDeleted: 1,
  },
  { path: "removed.md", changeType: "deleted", linesAdded: 0, linesDeleted: 8 },
];

const THREAD_COUNTS: Record<string, number> = { "docs/api/guide.md": 2 };

/** The rendered-article DOM the DocNav reads headings out of. Exercises the
 *  highlight tallying (open/resolved/draft/dup/no-id), a heading without an
 *  id, a heading outside a section, and a couple of collapsed sections. */
function Article(): React.ReactElement {
  const tall: React.CSSProperties = { minHeight: 260 };
  return (
    <>
      <section className="emr-section" data-section-id="intro" style={tall}>
        <h1 id="intro">Introduction</h1>
        <p>
          <span className="emr-highlight" data-thread-id="t1" />
          <span className="emr-highlight" data-thread-id="t4" />
          <span className="emr-highlight is-resolved" data-thread-id="t2" />
          <span className="emr-highlight" data-thread-id="__draft__" />
          <span className="emr-highlight" data-thread-id="t1" />
          <span className="emr-highlight" />
        </p>
      </section>
      <section className="emr-section" data-section-id="setup" style={tall}>
        <h2 id="setup">Setup</h2>
        <span className="emr-highlight is-resolved" data-thread-id="t3" />
        <h3 id="setup-deep">Deep dive</h3>
      </section>
      <section
        className="emr-section"
        data-section-id="usage"
        data-collapsed="true"
        style={tall}
      >
        <h2 id="usage">Usage</h2>
      </section>
      {/* Collapsed section with no id is skipped by the collapsed snapshot. */}
      <section className="emr-section" data-collapsed="true" style={tall}>
        <h2 id="extras">Extras</h2>
      </section>
      {/* A heading with no id is skipped entirely. */}
      <h4>Unindexed</h4>
      {/* A heading outside any section gets zero comment tallies. */}
      <h2 id="loose">Loose heading</h2>
    </>
  );
}

interface HarnessProps {
  files?: FileInfo[];
  unloadedFolders?: string[];
  onExpandFolder?: (
    path: string,
  ) => Promise<{ files: FileInfo[]; folders: string[] } | null>;
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  onSelectPath: (path: string) => void;
  initialSelected?: string;
  showChangeIndicators?: boolean;
}

function Harness(props: HarnessProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLElement | null>(null);
  const articleWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedPath, setSelectedPath] = React.useState(
    props.initialSelected ?? SELECTED,
  );
  // The real app bumps `version` once the article content has loaded; do the
  // same so DocNav re-reads the headings after the article is in the DOM.
  const [version, setVersion] = React.useState(0);

  const handleSelect = (path: string): void => {
    props.onSelectPath(path);
    setSelectedPath(path);
  };

  React.useEffect(() => {
    setVersion(1);
  }, []);

  return (
    <div style={{ display: "flex", height: 300, width: 640 }}>
      <DocNav
        articleWrapRef={articleWrapRef}
        scrollRef={scrollRef}
        version={version}
        files={props.files ?? FILES}
        selectedPath={selectedPath}
        onSelectPath={handleSelect}
        threadCountsByPath={THREAD_COUNTS}
        unloadedFolders={props.unloadedFolders}
        onExpandFolder={props.onExpandFolder}
        onSearchFiles={props.onSearchFiles}
        showChangeIndicators={props.showChangeIndicators}
      />
      <main
        ref={scrollRef as React.Ref<HTMLElement>}
        style={{ overflow: "auto", height: 300, flex: 1 }}
      >
        <div ref={articleWrapRef} className="emr-article-wrap">
          <Article />
        </div>
      </main>
    </div>
  );
}

/**
 * A host that simulates ADO streaming nested folder contents: each
 * `onExpandFolder` removes the just-fetched folder from `unloadedFolders` and
 * merges the files + child folders it yields (children may themselves be
 * lazy). This mirrors how DocumentsApp/PrShell fold streamed results back into
 * props, letting us exercise the deep-link auto-expand effect's chaining across
 * levels and its attempt-once guard.
 */
function LazyHostHarness(props: {
  initialSelected: string;
  initialUnloaded: string[];
  expansions: Record<string, { files: FileInfo[]; folders: string[] }>;
  onExpand: (path: string) => void;
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLElement | null>(null);
  const articleWrapRef = React.useRef<HTMLDivElement | null>(null);
  const [files, setFiles] = React.useState<FileInfo[]>([]);
  const [unloadedFolders, setUnloadedFolders] = React.useState<string[]>(
    props.initialUnloaded,
  );

  const onExpandFolder = React.useCallback(
    async (path: string) => {
      props.onExpand(path);
      const yielded = props.expansions[path] ?? { files: [], folders: [] };
      setFiles((curr) => [...curr, ...yielded.files]);
      // A fresh array reference each time (matching the host) so the lazy-set
      // memo recomputes and the auto-expand effect re-runs.
      setUnloadedFolders((curr) => [
        ...curr.filter((f) => f !== path),
        ...yielded.folders,
      ]);
      return yielded;
    },
    [props],
  );

  return (
    <div style={{ display: "flex", height: 300, width: 640 }}>
      <DocNav
        articleWrapRef={articleWrapRef}
        scrollRef={scrollRef}
        version={1}
        files={files}
        selectedPath={props.initialSelected}
        onSelectPath={() => {}}
        threadCountsByPath={{}}
        unloadedFolders={unloadedFolders}
        onExpandFolder={onExpandFolder}
      />
      <main ref={scrollRef as React.Ref<HTMLElement>} style={{ flex: 1 }}>
        <div ref={articleWrapRef} className="emr-article-wrap" />
      </main>
    </div>
  );
}

const meta = {
  title: "Components/DocNav",
  component: Harness,
  parameters: { layout: "fullscreen" },
  args: { onSelectPath: fn() },
} satisfies Meta<typeof Harness>;

export default meta;

type Story = StoryObj<typeof meta>;

/** File tree + heading TOC: folders toggle, headings fold and scroll, file
 *  rows switch the active file. */
export const TreeAndHeadings: Story = {
  play: async ({ canvasElement }) => {
    // Scope queries to the nav: heading text also appears in the article DOM.
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );

    // Heading badges: intro has 2 open, setup has a resolved one.
    await waitFor(() => expect(nav.getByText("Introduction")).toBeTruthy());
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-docnav-badge.is-open"),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-docnav-badge.is-resolved"),
      ).toBeTruthy(),
    );
    expect(canvasElement.querySelector(".emr-docnav-file-diff")).toBeNull();

    // Collapse then re-expand the folder (re-query: the row re-renders).
    await userEvent.click(nav.getByRole("button", { name: "Collapse folder" }));
    await userEvent.click(nav.getByRole("button", { name: "Expand folder" }));

    // Fold a heading section via its chevron, then unfold it. Both intro and
    // setup expose a "Collapse section" twist; fold setup (a leaf parent) so
    // the other heading rows stay visible.
    await userEvent.click(
      nav.getAllByRole("button", { name: "Collapse section" })[1]!,
    );
    await userEvent.click(nav.getByRole("button", { name: "Expand section" }));

    // Click a heading label (Usage is collapsed → it expands its section).
    await userEvent.click(nav.getByRole("button", { name: /Usage/ }));
    // Click the Introduction heading (already expanded → no section toggle).
    await userEvent.click(nav.getByRole("button", { name: /Introduction/ }));

    // Switch to a different file.
    await userEvent.click(nav.getByRole("button", { name: /internal\.md/ }));
    // A root-level file has no parent folders to auto-expand — it just selects.
    await userEvent.click(nav.getByRole("button", { name: /README\.md/ }));

    // Tonal + weight hierarchy: file names read heavier (semibold) than the
    // regular-weight heading rows nested beneath them, and the two use distinct
    // colour tokens (near-black file tone vs muted heading tone) so files
    // clearly out-rank headings. Assert the weight gap and that the colours
    // actually differ (exact rgb values are theme-driven, so compare relative).
    const fileName = canvasElement.querySelector(
      ".emr-docnav-file-name",
    ) as HTMLElement;
    const headingRow = canvasElement.querySelector(
      ".emr-docnav-item.lvl-2",
    ) as HTMLElement;
    expect(fileName).toBeTruthy();
    expect(headingRow).toBeTruthy();
    const fileStyle = getComputedStyle(fileName);
    const headingStyle = getComputedStyle(headingRow);
    expect(Number(fileStyle.fontWeight)).toBeGreaterThanOrEqual(600);
    // File tone and heading tone are different colours (the separation the
    // design relies on), not the same inherited foreground.
    expect(fileStyle.color).not.toBe(headingStyle.color);
  },
};

/** Fewer than five files: the search affordance is hidden (little to filter). */
export const FewFiles: Story = {
  args: {
    files: [
      {
        path: "README.md",
        changeType: "modified",
        linesAdded: 1,
        linesDeleted: 0,
      },
      {
        path: "CHANGELOG.md",
        changeType: "modified",
        linesAdded: 2,
        linesDeleted: 0,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );
    // Search is hidden, but the "Documents" title still shows (>1 file).
    await expect(
      nav.queryByRole("button", { name: "Search documents" }),
    ).toBeNull();
    await expect(nav.getByText("Documents")).toBeTruthy();
  },
};

/** A single file still shows the "Documents" header but hides search. */
export const SingleFile: Story = {
  args: {
    files: [
      {
        path: "README.md",
        changeType: "modified",
        linesAdded: 1,
        linesDeleted: 0,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );
    await waitFor(() => expect(nav.getByText(/README\.md/)).toBeTruthy());
    await expect(nav.getByText("Documents")).toBeTruthy();
    await expect(
      nav.queryByRole("button", { name: "Search documents" }),
    ).toBeNull();
  },
};

/** Re-selecting the active file scrolls the article back to the top. */
export const ReselectSameFile: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("guide.md")).toBeTruthy());
    await userEvent.click(canvas.getByRole("button", { name: /guide\.md/ }));
    // Same path → onSelectPath is NOT called (it scrolls instead).
    await expect(args.onSelectPath).not.toHaveBeenCalled();
  },
};

/** Scroll-spy lights up the heading scrolled past the top margin, and clears
 *  it again at the very top. */
export const ScrollSpy: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );
    await waitFor(() => expect(nav.getByText("Setup")).toBeTruthy());
    const scroller = canvasElement.querySelector("main") as HTMLElement;

    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-docnav-item.is-active"),
      ).toBeTruthy(),
    );

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-docnav-item.lvl-2.is-active"),
      ).toBeNull(),
    );
  },
};

/** Local file finder: open, filter, pick a result, short-query hint, clear and
 *  close via Escape, and blur-to-collapse. */
export const Search: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Search documents" }),
    );
    const input = canvas.getByRole("searchbox") as HTMLInputElement;

    await userEvent.type(input, "internal");
    await waitFor(() => expect(canvas.getByText("internal.md")).toBeTruthy());
    await userEvent.click(canvas.getByRole("button", { name: /internal\.md/ }));
    await expect(args.onSelectPath).toHaveBeenCalledWith(
      "docs/api/internal.md",
    );

    // One character → "type at least 2" hint.
    await userEvent.clear(input);
    await userEvent.type(input, "x");
    await waitFor(() =>
      expect(
        canvas.getByText("Type at least 2 characters to search."),
      ).toBeTruthy(),
    );

    // A query that matches nothing → "No files match".
    await userEvent.clear(input);
    await userEvent.type(input, "zzzzz");
    await waitFor(() =>
      expect(canvas.getByText(/No files match/)).toBeTruthy(),
    );

    // Escape clears the text, second Escape closes the box.
    await userEvent.type(input, "{Escape}");
    await waitFor(() => expect(input.value).toBe(""));
    await userEvent.type(input, "{Escape}");
    await waitFor(() => expect(canvas.queryByRole("searchbox")).toBeNull());
  },
};

/**
 * Documents-hub context (`showChangeIndicators={false}`): the tree shows the
 * latest master with no PR baseline, so the per-file A/M/D change glyphs are
 * suppressed in both the file tree and search results while the file names
 * themselves still render.
 */
export const NoChangeIndicators: Story = {
  args: { showChangeIndicators: false },
  play: async ({ canvasElement }) => {
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );
    await waitFor(() => expect(nav.getByText(/guide\.md/)).toBeTruthy());

    // No change-type glyphs anywhere in the tree.
    // (Scope to the A/M/D glyph variants so the folder chevron — which reuses
    // `.emr-docnav-file-icon` — isn't counted.)
    const changeGlyphSelector =
      ".emr-docnav-file-icon.is-added, .emr-docnav-file-icon.is-modified, .emr-docnav-file-icon.is-renamed, .emr-docnav-file-icon.is-deleted";
    expect(canvasElement.querySelectorAll(changeGlyphSelector).length).toBe(0);

    // Search results also omit the change glyph.
    await userEvent.click(
      nav.getByRole("button", { name: "Search documents" }),
    );
    const input = nav.getByRole("searchbox") as HTMLInputElement;
    await userEvent.type(input, "internal");
    await waitFor(() => expect(nav.getByText("internal.md")).toBeTruthy());
    expect(canvasElement.querySelectorAll(changeGlyphSelector).length).toBe(0);
  },
};

/** Blur with an empty box collapses the inline search. */
export const SearchBlurCollapses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Search documents" }),
    );
    const input = canvas.getByRole("searchbox") as HTMLInputElement;
    input.blur();
    await waitFor(() => expect(canvas.queryByRole("searchbox")).toBeNull());
  },
};

/** The close (X) button collapses an open search box. */
export const SearchCloseButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Search documents" }),
    );
    const input = canvas.getByRole("searchbox") as HTMLInputElement;
    await userEvent.type(input, "keep-open");
    await userEvent.click(canvas.getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(canvas.queryByRole("searchbox")).toBeNull());
  },
};

const REASONS = [
  "extension-missing",
  "auth",
  "network",
  "bad-request",
  "no-config",
  "mystery",
] as const;

/** Remote search "unavailable" banner renders a message per failure reason. */
export const RemoteUnavailable: Story = {
  args: {
    onSearchFiles: (query: string) => {
      const reason = REASONS[Math.min(query.length - 2, REASONS.length - 1)]!;
      return Promise.resolve({
        kind: "unavailable",
        reason,
      } as FileSearchOutcome);
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Search documents" }),
    );
    const input = canvas.getByRole("searchbox") as HTMLInputElement;
    const expected = [
      /Code Search isn't installed/,
      /Couldn't authenticate/,
      /Couldn't reach Code Search/,
      /Code Search rejected/,
      /Code Search isn't available here/,
      /unavailable right now/,
    ];
    for (let i = 0; i < REASONS.length; i += 1) {
      await userEvent.clear(input);
      await userEvent.type(input, "q".repeat(i + 2));
      await waitFor(() => expect(canvas.getByText(expected[i]!)).toBeTruthy(), {
        timeout: 3000,
      });
    }
  },
};

/** Selecting a file inside a manually-collapsed folder auto-expands its
 *  ancestor folders again so the active row stays visible. */
export const CollapsedAncestorReexpand: Story = {
  play: async ({ args, canvasElement }) => {
    const nav = within(
      canvasElement.querySelector(".emr-docnav") as HTMLElement,
    );
    await waitFor(() => expect(nav.getByText("guide.md")).toBeTruthy());
    // Collapse the docs/api folder.
    await userEvent.click(nav.getByRole("button", { name: "Collapse folder" }));
    await waitFor(() =>
      expect(nav.getByRole("button", { name: "Expand folder" })).toBeTruthy(),
    );
    // Picking a file inside it via search re-expands the ancestor folder.
    await userEvent.click(
      nav.getByRole("button", { name: "Search documents" }),
    );
    const input = nav.getByRole("searchbox") as HTMLInputElement;
    await userEvent.type(input, "internal");
    await waitFor(() => expect(nav.getByText("internal.md")).toBeTruthy());
    await userEvent.click(nav.getByRole("button", { name: /internal\.md/ }));
    await waitFor(() =>
      expect(args.onSelectPath).toHaveBeenCalledWith("docs/api/internal.md"),
    );
  },
};

/** Lazy folders fetch their contents on expand and show a spinner meanwhile. */
export const LazyFolders: Story = {
  args: {
    files: [],
    unloadedFolders: ["pending"],
    onExpandFolder: fn(
      () =>
        new Promise<{ files: FileInfo[]; folders: string[] }>((resolve) =>
          setTimeout(() => resolve({ files: [], folders: [] }), 50),
        ),
    ),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Load folder" }));
    // While the fetch is in flight the row shows a (disabled) spinner.
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Loading folder..." }),
      ).toBeTruthy(),
    );
    // Once it settles the callback has fired and the loading state clears.
    await waitFor(() => expect(args.onExpandFolder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        canvas.queryByRole("button", { name: "Loading folder..." }),
      ).toBeNull(),
    );
  },
};

/**
 * Regression: live ADO seeds `unloadedFolders` with leading-slash paths
 * (`/pending`) while the folder tree normalizes node paths (`pending`). The
 * lazy-set keys must be normalized the same way, otherwise the folder renders
 * as an inert empty row instead of an expandable "Load folder" one.
 */
export const LazyFoldersLeadingSlash: Story = {
  args: {
    files: [],
    unloadedFolders: ["/pending"],
    onExpandFolder: fn(
      () =>
        new Promise<{ files: FileInfo[]; folders: string[] }>((resolve) =>
          setTimeout(() => resolve({ files: [], folders: [] }), 50),
        ),
    ),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // The leading-slash folder is still recognized as lazy/expandable.
    await userEvent.click(canvas.getByRole("button", { name: "Load folder" }));
    await waitFor(() => expect(args.onExpandFolder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        canvas.queryByRole("button", { name: "Loading folder..." }),
      ).toBeNull(),
    );
  },
};

/**
 * Deep-link reveal: selecting a file under an *unenumerated* folder lazily
 * fetches that folder's contents automatically (no click) so the active file
 * surfaces in the tree.
 */
export const DeepLinkAutoExpand: Story = {
  args: {
    files: [],
    initialSelected: "/pending/buried.md",
    unloadedFolders: ["pending"],
    onExpandFolder: fn(
      () =>
        new Promise<{ files: FileInfo[]; folders: string[] }>((resolve) =>
          setTimeout(() => resolve({ files: [], folders: [] }), 20),
        ),
    ),
  },
  play: async ({ args }) => {
    // The ancestor folder is fetched automatically to reveal the deep-linked
    // file — without any user interaction.
    await waitFor(() =>
      expect(args.onExpandFolder).toHaveBeenCalledWith("pending"),
    );
  },
};

const chainExpandSpy = fn();
const guardExpandSpy = fn();

/**
 * Deep-link chaining: the selected file lives two lazy levels deep. Expanding
 * the first ancestor streams in the next (still-lazy) ancestor, which the
 * effect auto-expands in turn — until the file's own folder is enumerated.
 */
export const DeepLinkChainsThroughLazyLevels: Story = {
  render: () => (
    <LazyHostHarness
      initialSelected="api/rest/pull-requests.md"
      initialUnloaded={["api"]}
      expansions={{
        api: { files: [], folders: ["api/rest"] },
        "api/rest": {
          files: [
            {
              path: "api/rest/pull-requests.md",
              changeType: "modified",
              linesAdded: 1,
              linesDeleted: 0,
            },
          ],
          folders: [],
        },
      }}
      onExpand={chainExpandSpy}
    />
  ),
  play: async ({ canvasElement }) => {
    // Both lazy levels are fetched in order, then the deep-linked file row
    // surfaces in the tree.
    await waitFor(() =>
      expect(chainExpandSpy).toHaveBeenCalledWith("api/rest"),
    );
    expect(chainExpandSpy).toHaveBeenCalledWith("api");
    await waitFor(() =>
      expect(within(canvasElement).getByText("pull-requests.md")).toBeTruthy(),
    );
  },
};

/**
 * Regression: a deep-linked ancestor that stays lazy after its fetch (the host
 * re-lists it) must be auto-expanded exactly once. Without the attempt-once
 * guard the effect would re-fire on every `unloadedFolders` change and refetch
 * the folder forever.
 */
export const DeepLinkLazyAncestorFetchedOnce: Story = {
  render: () => (
    <LazyHostHarness
      initialSelected="stuck/file.md"
      initialUnloaded={["stuck"]}
      // Expanding "stuck" yields "stuck" again (still lazy) with a fresh array
      // reference, which would loop without the guard.
      expansions={{ stuck: { files: [], folders: ["stuck"] } }}
      onExpand={guardExpandSpy}
    />
  ),
  play: async () => {
    await waitFor(() => expect(guardExpandSpy).toHaveBeenCalled());
    // Give the effect several render cycles to (mis)fire a refetch loop.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(guardExpandSpy).toHaveBeenCalledTimes(1);
  },
};

/** Without an onExpandFolder callback, expanding a lazy folder is a no-op. */
export const LazyFoldersNoCallback: Story = {
  args: { files: [], unloadedFolders: ["pending"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Load folder" }));
    // Still present and not loading — the click did nothing.
    await expect(
      canvas.getByRole("button", { name: "Load folder" }),
    ).toBeTruthy();
  },
};

/** No files and no folders → the rail renders nothing. */
export const Empty: Story = {
  args: { files: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".emr-docnav")).toBeNull();
  },
};
