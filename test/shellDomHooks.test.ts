// React-hook tests for Shell's DOM-facing hooks — keyboard dismissal,
// rail-follow and document scrolling, links leaving the reader, pane resizing
// and the too-narrow check — mounted in jsdom with a manual frame queue.

import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    parentState,
    unmountAll,
} from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

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

const telemetry = recordTelemetryEachTest();

function effectsOptions(
    activeThreadId: string | null,
    overrides: Partial<EffectsOptions> = {},
): EffectsOptions {
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
        ...overrides,
    };
}

/** Puts a rendered comment highlight for `tid` into the document body. */
function highlightFor(tid: string) {
    return threadElement("markdown-body", "emr-highlight", tid);
}

const linkOutcomes = () =>
    telemetry.current.events
        .filter((event) => event.name === "link.opened")
        .map((event) => event.properties);

describe("useActiveThreadEffects", () => {
    it("leaves Escape inside a text field to the composer", async () => {
        const opts = effectsOptions(null);
        await mount(useActiveThreadEffects, opts);

        const field = document.body.appendChild(document.createElement("textarea"));

        const escape = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true });

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

describe("useActiveThreadEffects: dismissing the active thread", () => {
    function dismissible() {
        const active = parentState<string | null>("t1");
        const dismissEmptyDraft = vi.fn();

        const opts = effectsOptions("t1", {
            setActiveThreadId: active.set,
            dismissEmptyDraftRef: { current: dismissEmptyDraft },
        });

        return { active, dismissEmptyDraft, opts };
    }

    /** A plain paragraph of the reader, outside any comment UI. */
    function paragraph(): HTMLElement {
        return document.body.appendChild(document.createElement("p"));
    }

    const escape = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true });

    it("closes the active thread and an empty draft on Escape", async () => {
        const { active, dismissEmptyDraft, opts } = dismissible();
        await mount(useActiveThreadEffects, opts);
        document.body.dispatchEvent(escape());
        expect(active.value).toBeNull();
        expect(dismissEmptyDraft).toHaveBeenCalled();
    });

    it("keeps the active thread open on other keys", async () => {
        const { active, opts } = dismissible();
        await mount(useActiveThreadEffects, opts);
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(active.value).toBe("t1");
    });

    it("closes the active thread and an empty draft when the reader clicks elsewhere", async () => {
        const { active, dismissEmptyDraft, opts } = dismissible();
        await mount(useActiveThreadEffects, opts);
        paragraph().click();
        expect(active.value).toBeNull();
        expect(dismissEmptyDraft).toHaveBeenCalled();
    });

    it("keeps the active thread open when clicking inside its comment balloon", async () => {
        const { active, opts } = dismissible();
        await mount(useActiveThreadEffects, opts);
        const balloon = document.body.appendChild(document.createElement("div"));
        balloon.className = "emr-balloon";
        balloon.appendChild(document.createElement("button")).click();
        expect(active.value).toBe("t1");
    });

    it("keeps the active thread open when a comment control removes itself as it's clicked", async () => {
        const { active, opts } = dismissible();
        await mount(useActiveThreadEffects, opts);
        const row = paragraph();
        row.addEventListener("click", () => row.remove());
        row.click();
        expect(active.value).toBe("t1");
    });

    it.each([
        ["Escape", () => document.body.dispatchEvent(escape())],
        ["a click elsewhere", () => paragraph().click()],
    ])("stops reacting to %s once the reader has closed", async (_gesture, gesture) => {
        const { active, opts } = dismissible();
        const hook = await mount(useActiveThreadEffects, opts);
        hook.unmount();
        gesture();
        expect(active.value).toBe("t1");
    });
});

describe("useActiveThreadEffects: following the active thread in the rail", () => {
    it("scrolls the balloon to just below the rail header", async () => {
        const balloonScroll = threadElement("emr-rail-col", "emr-balloon", "t1");
        await mount(useActiveThreadEffects, effectsOptions("t1"));
        frames.flush();
        frames.flush();
        expect(balloonScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
});

describe("useActiveThreadEffects: opening a link to a comment", () => {
    function linkedTo(tid: string | undefined, overrides: Partial<EffectsOptions> = {}) {
        const active = parentState<string | null>(null);

        return {
            active,
            opts: effectsOptions(null, {
                initialActiveThreadId: tid,
                setActiveThreadId: active.set,
                ...overrides,
            }),
        };
    }

    it("opens the linked comment and centres its highlight in the document", async () => {
        const highlightScroll = highlightFor("t1");
        const { active, opts } = linkedTo("t1");
        await mount(useActiveThreadEffects, opts);
        frames.flush();
        expect(active.value).toBe("t1");
        expect(highlightScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(linkOutcomes()).toEqual([{ target: "comment", found: true }]);
    });

    it("opens a linked comment shown only in the rail", async () => {
        const balloonScroll = threadElement("emr-rail-col", "emr-balloon", "t1");
        const { active, opts } = linkedTo("t1");
        await mount(useActiveThreadEffects, opts);
        frames.flush();
        expect(active.value).toBe("t1");
        expect(balloonScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    });

    it("opens the linked comment once its highlight appears in the rendered document", async () => {
        const { active, opts } = linkedTo("t1");
        const hook = await mount(useActiveThreadEffects, opts);
        frames.flush();
        expect(active.value).toBeNull();
        highlightFor("t1");
        await hook.rerender({ ...opts, anchorLayout: {} as AnchorLayout });
        frames.flush();
        expect(active.value).toBe("t1");
    });

    it.each([
        ["clears the link", undefined],
        ["blanks the link", ""],
    ])(
        "still opens the linked comment when the host %s before the document renders",
        async (_change, laterLink) => {
            const { active, opts } = linkedTo("t1");
            const hook = await mount(useActiveThreadEffects, opts);
            frames.flush();
            await hook.rerender({ ...opts, initialActiveThreadId: laterLink });
            frames.flush();
            highlightFor("t1");
            await hook.rerender({
                ...opts,
                initialActiveThreadId: laterLink,
                anchorLayout: {} as AnchorLayout,
            });
            frames.flush();
            expect(active.value).toBe("t1");
        },
    );

    it("opens a comment link that arrives after the reader opened", async () => {
        highlightFor("t2");
        const { active, opts } = linkedTo(undefined);
        const hook = await mount(useActiveThreadEffects, opts);
        frames.flush();
        await hook.rerender({ ...opts, initialActiveThreadId: "t2" });
        frames.flush();
        expect(active.value).toBe("t2");
    });

    it("reports a linked comment once even when the document re-renders before it opens", async () => {
        highlightFor("t1");
        const { opts } = linkedTo("t1");
        const hook = await mount(useActiveThreadEffects, opts);
        await hook.rerender({ ...opts, renderVersion: 1 });
        frames.flush();
        expect(linkOutcomes()).toEqual([{ target: "comment", found: true }]);
    });

    it("reports a link to a deleted comment as not found, once, after the PR's comments load", async () => {
        const { active, opts } = linkedTo("gone", { prThreadSnapshots: 1 });
        const hook = await mount(useActiveThreadEffects, opts);
        frames.flush();
        await hook.rerender({ ...opts, renderVersion: 1 });
        frames.flush();
        expect(active.value).toBeNull();
        expect(linkOutcomes()).toEqual([{ target: "comment", found: false }]);
    });

    it.each([
        ["the PR's comments are still loading", 0, {}],
        ["the comment is known but its highlight isn't rendered yet", 1, { t1: {} }],
    ])(
        "keeps waiting for a linked comment while %s",
        async (_situation, snapshots, threadsById) => {
            const { active, opts } = linkedTo("t1", {
                prThreadSnapshots: snapshots,
                threadState: { threadsById, order: [] } as unknown as EffectsOptions["threadState"],
            });

            await mount(useActiveThreadEffects, opts);
            frames.flush();
            expect(active.value).toBeNull();
            expect(linkOutcomes()).toEqual([]);
        },
    );

    it.each([
        ["no comment link", undefined],
        ["an empty comment link", ""],
    ])("reports no link outcome for a document opened with %s", async (_link, tid) => {
        const { opts } = linkedTo(tid, { prThreadSnapshots: 1 });
        await mount(useActiveThreadEffects, opts);
        frames.flush();
        expect(linkOutcomes()).toEqual([]);
    });
});

describe("useActiveThreadEffects: mirroring the active thread into the URL", () => {
    it("leaves the URL's comment link alone when the reader opens", async () => {
        const onActiveThreadChange = vi.fn();
        await mount(useActiveThreadEffects, effectsOptions(null, { onActiveThreadChange }));
        expect(onActiveThreadChange).not.toHaveBeenCalled();
    });

    it("reports each newly selected or cleared thread to the host", async () => {
        const onActiveThreadChange = vi.fn();
        const opts = effectsOptions(null, { onActiveThreadChange });
        const hook = await mount(useActiveThreadEffects, opts);
        await hook.rerender({ ...opts, activeThreadId: "t1" });
        expect(onActiveThreadChange).toHaveBeenLastCalledWith("t1");
        await hook.rerender(opts);
        expect(onActiveThreadChange).toHaveBeenLastCalledWith(null);
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
            (prefs: typeof DEFAULT_READER_PREFS) => usePaneResize(prefs, setReaderPrefs),
            DEFAULT_READER_PREFS,
        );

        const pointer = {
            preventDefault: () => {},
            clientX: 0,
            pointerId: 1,
            currentTarget: { setPointerCapture: () => {} },
        } as unknown as ReactPointerEvent<HTMLDivElement>;

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
            (frame: MutableRefObject<HTMLDivElement | null>) =>
                useTooNarrow(frame, false, true, DEFAULT_READER_PREFS),
            { current: null },
        );

        expect(current).toBe(false);
    });
});
