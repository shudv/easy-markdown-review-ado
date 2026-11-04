// React-hook tests for Shell's DOM-facing hooks — keyboard dismissal,
// rail-follow and document scrolling, links leaving the reader, pane resizing
// and the too-narrow check — mounted in jsdom with a manual frame queue.

import type * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AnchorLayout } from "../src/shell/components/ArticleView.types";
import { DEFAULT_READER_PREFS } from "../src/shell/readerPrefs";
import { useActiveThreadEffects } from "../src/shell/shell/useActiveThreadEffects";
import { useDocNavigation } from "../src/shell/shell/useDocNavigation";
import { useDocScroll } from "../src/shell/shell/useDocScroll";
import { usePaneResize } from "../src/shell/shell/usePaneResize";
import { useTooNarrow } from "../src/shell/shell/useTooNarrow";
import {
  ensureCssEscape,
  manualFrames,
  mountTracked as mount,
  unmountAll,
} from "./shellHarness";

type EffectsOptions = Parameters<typeof useActiveThreadEffects>[0];

let frames: ReturnType<typeof manualFrames>;

beforeAll(ensureCssEscape);
beforeEach(() => {
  frames = manualFrames();
});
afterEach(() => {
  unmountAll();
  frames.restore();
  document.body.innerHTML = "";
});

/** Mounts `.parentClass > .childClass[data-thread-id]`; returns its scroll spy. */
function threadElement(parentClass: string, childClass: string, tid: string) {
  const parent = document.createElement("div");
  parent.className = parentClass;
  const el = document.createElement("div");
  if (childClass) el.className = childClass;
  el.dataset.threadId = tid;
  const scroll = vi.fn();
  el.scrollIntoView = scroll;
  parent.appendChild(el);
  document.body.appendChild(parent);
  return scroll;
}

function effectsOptions(activeThreadId: string | null): EffectsOptions {
  return {
    activeThreadId,
    setActiveThreadId: vi.fn(),
    dismissEmptyDraftRef: { current: vi.fn() },
    initialActiveThreadId: undefined,
    onActiveThreadChange: undefined,
    selectedPath: "docs/a.md",
    threadState: { threadsById: {}, order: [] },
    prThreadSnapshots: 0,
    renderVersion: 0,
    anchorLayout: {} as AnchorLayout,
  };
}

describe("useActiveThreadEffects", () => {
  it("leaves Escape inside a text field to the composer", async () => {
    const opts = effectsOptions(null);
    await mount(useActiveThreadEffects, opts);
    const field = document.body.appendChild(document.createElement("textarea"));
    const escape = () =>
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    field.dispatchEvent(escape());
    expect(opts.setActiveThreadId).not.toHaveBeenCalled();
    document.body.dispatchEvent(escape());
    expect(opts.setActiveThreadId).toHaveBeenCalledTimes(1);
  });

  it("scrolls the rail to the active thread's balloon after two frames", async () => {
    const balloonScroll = threadElement("emr-rail-col", "emr-balloon", "t1");
    await mount(useActiveThreadEffects, effectsOptions("t1"));
    frames.flush();
    frames.flush();
    expect(balloonScroll).toHaveBeenCalledTimes(1);
  });

  it("skips the rail scroll when the active thread changes between frames", async () => {
    const balloonScroll = threadElement("emr-rail-col", "emr-balloon", "t1");
    const hook = await mount(useActiveThreadEffects, effectsOptions("t1"));
    frames.flush();
    await hook.rerender(effectsOptions("t2"));
    frames.flush();
    frames.flush();
    expect(balloonScroll).not.toHaveBeenCalled();
  });

  it("does nothing when the active thread has no balloon", async () => {
    await mount(useActiveThreadEffects, effectsOptions("missing"));
    expect(() => {
      frames.flush();
      frames.flush();
    }).not.toThrow();
  });
});

describe("useDocScroll", () => {
  it("scrolls to a thread's highlight only when it is rendered", async () => {
    const { current } = await mount(useDocScroll, "docs/a.md");
    current.scrollDocToAnchor("t1");
    expect(() => frames.flush()).not.toThrow();
    const highlightScroll = threadElement("markdown-body", "", "t1");
    current.scrollDocToAnchor("t1");
    frames.flush();
    expect(highlightScroll).toHaveBeenCalledTimes(1);
  });

  it("resolves no heading or text before the article is mounted", async () => {
    const { current } = await mount(useDocScroll, "docs/a.md");
    const onResolved = vi.fn();
    current.scrollDocToHash("intro", { onResolved });
    current.scrollDocToText("quoted", onResolved);
    frames.flush();
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe("useDocNavigation", () => {
  it("consumes links that leave the reader even without host navigation", async () => {
    const { current } = await mount(useDocNavigation, {
      initialActiveThreadId: undefined,
      initialAnchor: undefined,
      initialTextFragment: undefined,
      documentsMode: false,
      files: [],
      selectedPath: "docs/a.md",
      isHub: false,
      missingDoc: null,
      onSelectPath: undefined,
      onDocNavigate: undefined,
      setSelectedPath: vi.fn(),
      setActiveThreadId: vi.fn(),
      setMissingDoc: vi.fn(),
      setLoading: vi.fn(),
      dismissEmptyDraftRef: { current: vi.fn() },
      handleMissingDocRef: { current: () => "unexpected" as const },
      scrollDocToHash: vi.fn(),
    });
    expect(current.handleDocLink("diagram.png")).toBe(true);
    expect(current.handleDocLink("other.md#setup")).toBe(true);
  });
});

describe("usePaneResize", () => {
  it("ignores resize drags while the reader frame is unmounted", async () => {
    const setReaderPrefs = vi.fn();
    const { current } = await mount(
      (prefs: typeof DEFAULT_READER_PREFS) =>
        usePaneResize(prefs, setReaderPrefs),
      DEFAULT_READER_PREFS,
    );
    const pointer = {
      preventDefault: () => {},
      clientX: 0,
      pointerId: 1,
      currentTarget: { setPointerCapture: () => {} },
    } as unknown as React.PointerEvent<HTMLDivElement>;
    current.onNavResizeStart(pointer);
    current.onNavResizeMove({ ...pointer, clientX: 40 });
    current.onCommentResizeStart(pointer);
    current.onCommentResizeMove({ ...pointer, clientX: -40 });
    expect(setReaderPrefs).not.toHaveBeenCalled();
  });
});

describe("useTooNarrow", () => {
  it("stays usable while the reader frame is unmounted", async () => {
    const { current } = await mount(
      (frame: React.MutableRefObject<HTMLDivElement | null>) =>
        useTooNarrow(frame, false, true, DEFAULT_READER_PREFS),
      { current: null },
    );
    expect(current).toBe(false);
  });
});
