// Tests for the reader-control engagement telemetry: PR-update comparisons,
// panel toggles, reading preferences and the change minimap.

import { afterEach, describe, expect, it, vi } from "vitest";

import { comparisonScope, trackMinimapUse } from "../src/shell/shell/readerTelemetry";
import { PREF_EVENT_COOLDOWN_MS, useReaderPrefs } from "../src/shell/shell/useReaderPrefs";
import { useIterationControls } from "../src/shell/shell/useIterationControls";
import { mountTracked, unmountAll, userAction } from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

afterEach(() => {
    unmountAll();
    vi.useRealTimers();
    window.localStorage.clear();
});

const propertiesOf = (name: string) =>
    telemetry.current.events.filter((e) => e.name === name).map((e) => e.properties);

describe("comparisonScope", () => {
    it.each([
        { range: { fromUpdate: 0, toUpdate: 4 }, count: 4, scope: "all" },
        { range: { fromUpdate: 0, toUpdate: 1 }, count: 1, scope: "all" },
        { range: { fromUpdate: 2, toUpdate: 3 }, count: 4, scope: "single" },
        { range: { fromUpdate: 0, toUpdate: 1 }, count: 4, scope: "single" },
        { range: { fromUpdate: 1, toUpdate: 4 }, count: 4, scope: "range" },
        { range: { fromUpdate: 0, toUpdate: 3 }, count: 4, scope: "range" },
    ])("calls $range of $count updates '$scope'", ({ range, count, scope }) => {
        expect(comparisonScope(range, count)).toBe(scope);
    });
});

describe("trackMinimapUse", () => {
    it("reports how the change minimap was used", () => {
        trackMinimapUse("drag");
        expect(propertiesOf("minimap.used")).toEqual([{ via: "drag" }]);
    });
});

describe("useIterationControls: comparing PR updates", () => {
    it("reports the scope of each comparison the reader picks", async () => {
        const hook = await mountTracked(useIterationControls, {
            completedPrHistoryEnabled: false,
            nativeIterationMode: true,
            viewingHistorical: false,
            historyStops: [],
            clampedStopIndex: 0,
            nativeUpdateCount: 3,
            comparisonStart: 0,
            latestHtml: undefined,
            setCompletedHistoryStopIndex: vi.fn(),
            setIterationRange: vi.fn(),
            setActiveThreadId: vi.fn(),
            dismissEmptyDraftRef: { current: vi.fn() },
        });

        await userAction(() => hook.current.changeIterationRange({ fromUpdate: 2, toUpdate: 3 }));
        await userAction(() => hook.current.changeIterationRange({ fromUpdate: 0, toUpdate: 3 }));
        expect(propertiesOf("updates.compared")).toEqual([{ scope: "single" }, { scope: "all" }]);
    });
});

describe("useReaderPrefs: reader control telemetry", () => {
    it("reports each panel shown or hidden with its new visibility", async () => {
        const hook = await mountTracked(useReaderPrefs, "pr");

        const shownBefore = {
            nav: hook.current.readerPrefs.showNav,
            outline: hook.current.readerPrefs.showOutline,
            comments: hook.current.readerPrefs.showComments,
        };

        await userAction(() => hook.current.toggleReaderNav());
        await userAction(() => hook.current.toggleReaderOutline());
        await userAction(() => hook.current.toggleReaderComments());
        await userAction(() => hook.current.toggleReaderOutline());

        expect(propertiesOf("panel.toggled")).toEqual([
            { panel: "nav", visible: !shownBefore.nav },
            { panel: "outline", visible: !shownBefore.outline },
            { panel: "comments", visible: !shownBefore.comments },
            { panel: "outline", visible: shownBefore.outline },
        ]);
        expect(hook.current.readerPrefs.showOutline).toBe(shownBefore.outline);
    });

    it("counts a slider drag as one change, and a later drag as another", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const hook = await mountTracked(useReaderPrefs, "pr");
        await userAction(() => hook.current.setReaderSize(110));
        await userAction(() => hook.current.setReaderSize(111));
        await userAction(() => hook.current.setReaderSpacing(120));
        await userAction(() => hook.current.setReaderFont("serif"));
        vi.setSystemTime(Date.now() + PREF_EVENT_COOLDOWN_MS);
        await userAction(() => hook.current.setReaderSize(112));

        expect(propertiesOf("reader.prefChanged")).toEqual([
            { setting: "size" },
            { setting: "spacing" },
            { setting: "font" },
            { setting: "size" },
        ]);
        expect(hook.current.readerPrefs.sizePct).toBe(112);
        expect(hook.current.readerPrefs.lineSpacingPct).toBe(120);
        expect(hook.current.readerPrefs.fontId).toBe("serif");
    });
});
