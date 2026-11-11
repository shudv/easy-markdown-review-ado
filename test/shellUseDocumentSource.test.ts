// React-hook tests for useDocumentSource, mounted in a jsdom root so the real
// load effect drives the per-file cache and the load/error state.
//
// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentSource } from "../src/shell/shell/useDocumentSource";
import type { FileInfo } from "../src/types";
import { __resetBootTimingForTests, markBootStart } from "../src/telemetry/bootTiming";
import { deferred, HELD_SOURCE, heldRender, type Deferred } from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

vi.mock("../src/markdown/render", async (importOriginal) =>
    (await import("./shellHarness")).withHeldRender(
        await importOriginal<typeof import("../src/markdown/render")>(),
    ),
);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DocumentSource = ReturnType<typeof useDocumentSource>;

let doc: DocumentSource;
let container: HTMLDivElement;
let root: Root;

type MissingDocOutcome = ReturnType<DocumentSource["handleMissingDocRef"]["current"]>;

function Harness(props: {
    selectedPath: string;
    loadFileSource: (path: string, objectId?: string) => Promise<string>;
    missingDocOutcome: MissingDocOutcome;
    files: FileInfo[];
}): null {
    const source = useDocumentSource(props.selectedPath, props.loadFileSource, props.files);
    const missingDocRef = source.handleMissingDocRef;
    const { missingDocOutcome } = props;
    // Publish after commit, before the hook's passive load effect reads the ref.
    useLayoutEffect(() => {
        doc = source;
        missingDocRef.current = () => missingDocOutcome;
    });

    return null;
}

async function show(
    selectedPath: string,
    loadFileSource: (path: string, objectId?: string) => Promise<string>,
    missingDocOutcome: MissingDocOutcome = "unexpected",
    files: FileInfo[] = [],
): Promise<void> {
    await act(async () => {
        root.render(
            createElement(Harness, { selectedPath, loadFileSource, missingDocOutcome, files }),
        );
    });
    // Let the load and the Markdown render settle.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

const telemetry = recordTelemetryEachTest();

const notFound = () => new Error("TF401174: The item docs/gone.md could not be found.");

const loadsOnly =
    (path: string, source: string) =>
    (requested: string): Promise<string> =>
        requested === path ? Promise.resolve(source) : Promise.reject(notFound());

describe("useDocumentSource", () => {
    it("clears a failed load's error when switching back to a cached document", async () => {
        const loadFileSource = (path: string): Promise<string> =>
            path === "docs/a.md"
                ? Promise.resolve("# A")
                : Promise.reject(new Error("load failed"));

        await show("docs/a.md", loadFileSource);
        expect(doc.htmlByPath["docs/a.md"]).toContain("A");
        expect(doc.error).toBeNull();

        await show("docs/b.md", loadFileSource);
        expect(doc.error).toContain("load failed");

        await show("docs/a.md", loadFileSource);
        expect(doc.error).toBeNull();
        expect(doc.loading).toBe(false);
    });

    it("stops the spinner when switching from an in-flight load to a cached document", async () => {
        const loadFileSource = (path: string): Promise<string> =>
            path === "docs/a.md" ? Promise.resolve("# A") : new Promise<string>(() => {});

        await show("docs/a.md", loadFileSource);
        await show("docs/slow.md", loadFileSource);
        expect(doc.loading).toBe(true);

        await show("docs/a.md", loadFileSource);
        expect(doc.loading).toBe(false);
    });

    it("loads nothing until a file is selected", async () => {
        const loadFileSource = vi.fn(() => Promise.resolve("# A"));
        await show("", loadFileSource);
        expect(loadFileSource).not.toHaveBeenCalled();
        expect(doc.loading).toBe(false);
    });

    /**
     * Opens `docs/slow.md` (held on `slow`), moves to `docs/a.md`, lets
     * `settleSlow` finish the abandoned load, then re-renders `docs/a.md`.
     */
    async function abandonSlowLoad(settleSlow: (slow: Deferred<string>) => void): Promise<void> {
        const slow = deferred<string>();

        const loadFileSource = (path: string): Promise<string> =>
            path === "docs/slow.md" ? slow.promise : Promise.resolve("# A");

        await show("docs/slow.md", loadFileSource);
        await show("docs/a.md", loadFileSource);
        settleSlow(slow);
        await show("docs/a.md", loadFileSource);
    }

    it("drops a load that resolves after the selection moved on", async () => {
        await abandonSlowLoad((slow) => slow.resolve("# Slow"));
        expect(doc.htmlByPath["docs/slow.md"]).toBeUndefined();
        expect(doc.sourceByPath["docs/slow.md"]).toBeUndefined();
    });

    it("drops a render that finishes after the selection moved on", async () => {
        heldRender.gate = deferred<void>();

        const loadFileSource = (path: string): Promise<string> =>
            Promise.resolve(path === "docs/held.md" ? HELD_SOURCE : "# A");

        try {
            await show("docs/held.md", loadFileSource);
            await show("docs/a.md", loadFileSource);
            heldRender.gate.resolve();
            await show("docs/a.md", loadFileSource);
            expect(doc.htmlByPath["docs/held.md"]).toBeUndefined();
            expect(doc.htmlByPath["docs/a.md"]).toContain("A");
        } finally {
            heldRender.gate = null;
        }
    });

    it("ignores a failure that surfaces after the selection moved on", async () => {
        await abandonSlowLoad((slow) => slow.reject(new Error("late failure")));
        expect(doc.error).toBeNull();
    });
});

describe("useDocumentSource: the listed blob", () => {
    const listed = (path: string, objectId?: string): FileInfo => ({
        path,
        changeType: "modified",
        linesAdded: 0,
        linesDeleted: 0,
        objectId,
    });

    it("passes a listed file's blob id to the loader", async () => {
        const load = vi.fn(async () => "# A");
        await show("docs/a.md", load, "unexpected", [listed("docs/a.md", "e5492baf")]);

        expect(load).toHaveBeenCalledExactlyOnceWith("docs/a.md", "e5492baf");
    });

    it("passes no blob id for a file that isn't listed with one", async () => {
        const load = vi.fn(async () => "# A");
        await show("docs/a.md", load, "unexpected", [listed("docs/b.md", "e5492baf")]);

        expect(load).toHaveBeenCalledExactlyOnceWith("docs/a.md", undefined);
    });

    it("doesn't reload a document when the file list grows", async () => {
        const load = vi.fn(async () => "# A");
        await show("docs/a.md", load, "unexpected", [listed("docs/a.md", "e5492baf")]);
        await show("docs/a.md", load, "unexpected", [
            listed("docs/a.md", "e5492baf"),
            listed("docs/b.md"),
        ]);

        expect(load).toHaveBeenCalledOnce();
    });
});

describe("useDocumentSource: opening a document", () => {
    it("shows the rendered document and keeps its source for anchoring comments", async () => {
        await show("docs/a.md", loadsOnly("docs/a.md", "# Alpha"));
        expect(doc.loading).toBe(false);
        expect(doc.sourceByPath).toEqual({ "docs/a.md": "# Alpha" });
        expect(doc.htmlByPath["docs/a.md"]).toContain("Alpha");
    });

    const titled = (path: string) => Promise.resolve(`# ${path}`);

    it("signals a fresh render once a document finishes rendering", async () => {
        await show("", titled);
        const before = doc.renderVersion;
        await show("docs/a.md", titled);
        expect(doc.renderVersion).toBeGreaterThan(before);
    });

    it("signals a fresh render when the reader returns to an already rendered document", async () => {
        await show("docs/a.md", titled);
        await show("docs/b.md", titled);
        const before = doc.renderVersion;
        await show("docs/a.md", titled);
        expect(doc.renderVersion).toBeGreaterThan(before);
    });

    it("stops the spinner and shows why a document failed to load", async () => {
        await show("docs/a.md", () => Promise.reject(new Error("Server busy")));
        expect(doc.loading).toBe(false);
        expect(doc.error).toBe("Server busy");
    });

    it.each([
        ["a server failure", new Error("Server busy"), "unexpected" as const],
        ["a document nobody expected to be missing", notFound(), "unexpected" as const],
    ])("reports %s as blocking the reader", async (_failure, error, outcome) => {
        await show("docs/gone.md", () => Promise.reject(error), outcome);
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "Shell.documentLoad",
                operation: "document-load",
                impact: "blocking",
            }),
        ]);
    });

    it("shows a missing linked document's error without reporting it as a failure", async () => {
        await show("docs/gone.md", () => Promise.reject(notFound()), "expected");
        expect(doc.error).toContain("TF401174");
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("shows no error when a missing document was replaced by another one", async () => {
        await show("docs/gone.md", () => Promise.reject(notFound()), "replaced");
        expect(doc.error).toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });
});

describe("useDocumentSource: reporting which rich features a document uses", () => {
    const featureEvents = () =>
        telemetry.current.events.filter((event) => event.name === "document.features");

    it("counts the diagrams, equations, drawings and wiki macros a rendered document uses", async () => {
        const source = [
            "# A",
            "[[_TOC_]]",
            "```mermaid\ngraph TD; A-->B\n```",
            "Energy $E=mc^2$",
            "![flow](flow.excalidraw)",
        ].join("\n\n");

        await show("docs/a.md", loadsOnly("docs/a.md", source));
        expect(featureEvents()).toEqual([
            expect.objectContaining({
                measurements: { diagrams: 1, equations: 1, drawings: 1, wikiMacros: 1 },
            }),
        ]);
    });

    it("reports nothing for a plain document", async () => {
        await show("docs/a.md", loadsOnly("docs/a.md", "# Plain\n\nJust text."));
        expect(featureEvents()).toEqual([]);
    });
});

describe("useDocumentSource: reporting when the app has loaded", () => {
    beforeEach(() => {
        __resetBootTimingForTests();
        markBootStart();
    });

    afterEach(() => {
        __resetBootTimingForTests();
    });

    const readyReasons = () =>
        telemetry.current.events
            .filter((event) => event.name === "app.loaded")
            .map((event) => event.properties?.readyReason);

    it("reports the app loaded once the first document has rendered", async () => {
        await show("docs/a.md", loadsOnly("docs/a.md", "# Alpha"));
        expect(readyReasons()).toEqual(["content"]);
    });

    it("reports the size of the first rendered document", async () => {
        await show("docs/a.md", loadsOnly("docs/a.md", "# Alpha"));
        const loaded = telemetry.current.events.find((event) => event.name === "app.loaded");
        expect(loaded!.measurements).toMatchObject({ docChars: "# Alpha".length });
    });

    it.each([
        ["a message", new Error("Server busy")],
        ["a blank message", new Error("")],
    ])(
        "reports the app loaded with an error when the first document fails to load with %s",
        async (_failure, error) => {
            await show("docs/a.md", () => Promise.reject(error));
            expect(readyReasons()).toEqual(["error"]);
        },
    );

    it.each([
        ["no document is selected yet", "", () => Promise.resolve("# A")],
        ["the first document is still loading", "docs/a.md", () => new Promise<string>(() => {})],
    ])("doesn't report the app loaded while %s", async (_situation, path, loadFileSource) => {
        await show(path, loadFileSource);
        expect(readyReasons()).toEqual([]);
    });
});
