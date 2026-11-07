// @vitest-environment jsdom

import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

// Mock the `mermaid` module BEFORE importing the SUT so the dynamic
// `import("mermaid")` inside `hydrateMermaid` resolves to our stub.
vi.mock("mermaid", () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn(async (id: string, src: string) => ({
            svg: `<svg data-id="${id}" data-src="${src.length}"></svg>`,
            diagramType: "flowchart",
        })),
    },
}));

import mermaid from "mermaid";
import { isChunkLoadError } from "../src/markdown/chunkRetry";
import { hydrateMermaid, isDiagramSyntaxError } from "../src/markdown/mermaidHydrate";
import { recordTelemetryEachTest } from "./telemetrySink";

// Failures are reported once per diagram source per page load, and that memory
// lives for the whole file: every test that expects a report uses its own source.
const telemetry = recordTelemetryEachTest();
const defaultRender = vi.mocked(mermaid.render).getMockImplementation()!;

beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-emr-theme");
    vi.mocked(mermaid.render).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.mocked(mermaid.render).mockReset();
    vi.mocked(mermaid.render).mockImplementation(defaultRender);
    vi.restoreAllMocks();
});

function mountDiagram(source: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML =
        `<div class="emr-mermaid" data-mermaid-src="${encodeURIComponent(source)}">` +
        `<pre class="emr-mermaid-fallback">${source}</pre></div>`;
    document.body.appendChild(root);

    return root;
}

function diagramOf(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>(".emr-mermaid")!;
}

function chunkError(): Error {
    return Object.assign(new Error("Loading chunk 812 failed.\n(error: x)"), {
        name: "ChunkLoadError",
    });
}

describe("hydrateMermaid", () => {
    it("leaves a document without diagrams untouched", async () => {
        const root = document.createElement("div");
        root.innerHTML = "<p>nothing to hydrate</p>";

        await hydrateMermaid(root);

        expect(root.innerHTML).toBe("<p>nothing to hydrate</p>");
    });

    it("replaces a diagram's source with its SVG, drawn in the reader's font", async () => {
        const root = mountDiagram("graph TD\nA-->B");
        const readerFont = 'Georgia, "Times New Roman", serif';

        await hydrateMermaid(root, readerFont);

        const el = diagramOf(root);
        expect(el.getAttribute("data-hydrated")).toBe("true");
        expect(el.querySelector("svg")).not.toBeNull();
        expect(el.querySelector(".emr-mermaid-fallback")).toBeNull();
        // No `data-emr-theme` → the light theme.
        expect(el.getAttribute("data-mermaid-theme")).toBe("default");
        expect(el.getAttribute("data-mermaid-font")).toBe(readerFont);
        // Diagrams are drawn at the reader's prose size (not Mermaid's 16px default)
        // so they don't tower over the body copy.
        expect(mermaid.initialize).toHaveBeenLastCalledWith(
            expect.objectContaining({
                theme: "default",
                fontSize: 14,
                fontFamily: readerFont,
            }),
        );
    });

    it("scales the diagram from its viewBox: captures the natural width and strips Mermaid's inline size caps", async () => {
        // A realistic Mermaid SVG carries a viewBox plus its own width/height and an
        // inline max-width cap.
        vi.mocked(mermaid.render).mockResolvedValueOnce({
            svg: '<svg viewBox="0 0 400 200" width="400" height="200" style="max-width: 400px"></svg>',
            diagramType: "flowchart",
        });
        const root = mountDiagram("graph TD\nA-->B");

        await hydrateMermaid(root);

        const el = diagramOf(root);
        // The natural width (the viewBox's 3rd value) drives the reader-scale sizing.
        expect(el.style.getPropertyValue("--emr-diagram-natural-w")).toBe("400px");
        const svg = el.querySelector("svg")!;
        // Mermaid's own inline size caps are stripped so the stylesheet governs the
        // size (scaled by `--emr-reader-scale`, capped at the reading column).
        expect(svg.hasAttribute("width")).toBe(false);
        expect(svg.hasAttribute("height")).toBe(false);
        expect(svg.style.maxWidth).toBe("");
    });

    it("leaves a diagram already drawn in the current theme and font as is", async () => {
        const root = document.createElement("div");
        const readerFont = 'Georgia, "Times New Roman", serif';
        root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="x" data-hydrated="true" data-mermaid-theme="default"><pre>old</pre></div>`;
        diagramOf(root).setAttribute("data-mermaid-font", readerFont);
        document.body.appendChild(root);

        await hydrateMermaid(root, readerFont);

        expect(diagramOf(root).innerHTML).toBe("<pre>old</pre>");
    });

    it("redraws a diagram when the reader font changes", async () => {
        const root = mountDiagram("graph TD\nA-->B");

        await hydrateMermaid(root, "Georgia, serif");
        const el = diagramOf(root);
        const georgiaHtml = el.innerHTML;

        await hydrateMermaid(root, "Verdana, sans-serif");

        expect(el.getAttribute("data-mermaid-font")).toBe("Verdana, sans-serif");
        expect(el.innerHTML).not.toBe(georgiaHtml);
        expect(mermaid.initialize).toHaveBeenLastCalledWith(
            expect.objectContaining({ fontFamily: "Verdana, sans-serif" }),
        );
    });

    it.each([
        { name: "an empty source", encoded: "" },
        // A lone `%` is an invalid percent-escape.
        { name: "an undecodable source", encoded: "%" },
    ])("leaves a placeholder with $name unrendered", async ({ encoded }) => {
        const root = document.createElement("div");
        root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${encoded}"></div>`;
        document.body.appendChild(root);

        await hydrateMermaid(root);

        const el = diagramOf(root);
        expect(el.getAttribute("data-hydrated")).toBeNull();
        expect(el.innerHTML).toBe("");
    });

    it("renders in the dark theme when the reader is dark", async () => {
        document.documentElement.setAttribute("data-emr-theme", "dark");
        const root = mountDiagram("graph TD\nA-->B");

        await hydrateMermaid(root);

        expect(diagramOf(root).getAttribute("data-mermaid-theme")).toBe("dark");
        expect(mermaid.initialize).toHaveBeenLastCalledWith(
            expect.objectContaining({ theme: "dark" }),
        );
    });

    it("redraws a light diagram in the dark theme when the reader turns dark", async () => {
        const root = mountDiagram("graph TD\nA-->B");
        await hydrateMermaid(root);
        const el = diagramOf(root);
        const lightHtml = el.innerHTML;

        document.documentElement.setAttribute("data-emr-theme", "dark");
        await hydrateMermaid(root);

        expect(el.getAttribute("data-mermaid-theme")).toBe("dark");
        expect(el.innerHTML).not.toBe(lightHtml);
    });

    it("keeps the readable source of a diagram Mermaid fails to draw, and reports it", async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("bad graph"));
        const root = mountDiagram("graph TD\nA-->B: render-fails");

        await hydrateMermaid(root);

        const el = diagramOf(root);
        expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
        expect(el.getAttribute("data-hydrated")).toBe("true");
        expect(el.querySelector(".emr-mermaid-fallback")).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "bad graph" }),
                source: "Mermaid.hydrate",
                operation: "diagram-render",
                impact: "degraded",
            }),
        ]);
    });

    it("clears a prior render error when a later redraw succeeds", async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("bad graph"));
        const root = mountDiagram("graph TD\nA-->B");

        await hydrateMermaid(root, "Georgia, serif");
        const el = diagramOf(root);
        expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");

        await hydrateMermaid(root, "Verdana, sans-serif");

        expect(el.getAttribute("data-mermaid-error")).toBeNull();
        expect(el.querySelector("svg")).not.toBeNull();
        expect(el.querySelector(".emr-mermaid-fallback")).toBeNull();
    });
});

describe("hydrateMermaid — transient chunk failures", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Production: 20 ChunkLoadErrors in 15 sessions left diagrams as raw source.
    // The retry policy is two retries, after 1 s and then 3 s.
    it("retries a failed diagram chunk after 1 s and 3 s, then draws the diagram", async () => {
        vi.mocked(mermaid.render)
            .mockRejectedValueOnce(chunkError())
            .mockRejectedValueOnce(chunkError());
        const root = mountDiagram("sequenceDiagram\nA->>B: chunk-retry-ok");

        const pass = hydrateMermaid(root);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(mermaid.render).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(3_000);
        await pass;

        const el = diagramOf(root);
        expect(mermaid.render).toHaveBeenCalledTimes(3);
        expect(el.getAttribute("data-mermaid-error")).toBeNull();
        expect(el.querySelector("svg")).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("gives every render attempt its own DOM id, as Mermaid requires", async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(chunkError());
        const root = mountDiagram("sequenceDiagram\nA->>B: chunk-retry-ids");

        const pass = hydrateMermaid(root);
        await vi.advanceTimersByTimeAsync(1_000);
        await pass;

        const ids = vi.mocked(mermaid.render).mock.calls.map(([id]) => id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    it("gives up after the retries, keeps the readable source, and reports it", async () => {
        vi.mocked(mermaid.render)
            .mockRejectedValueOnce(chunkError())
            .mockRejectedValueOnce(chunkError())
            .mockRejectedValueOnce(chunkError());
        const root = mountDiagram("sequenceDiagram\nA->>B: chunk-retry-exhausted");

        const pass = hydrateMermaid(root);
        await vi.advanceTimersByTimeAsync(4_000);
        await pass;

        const el = diagramOf(root);
        expect(mermaid.render).toHaveBeenCalledTimes(3);
        expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
        expect(el.querySelector(".emr-mermaid-fallback")).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ name: "ChunkLoadError" }),
                operation: "diagram-render",
            }),
        ]);
    });

    it("does not retry a diagram the author wrote wrongly", async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error on line 2"));
        const root = mountDiagram("sequenceDiagram\nA->>B broken arrow");

        await hydrateMermaid(root);

        expect(mermaid.render).toHaveBeenCalledOnce();
        expect(diagramOf(root).getAttribute("data-mermaid-error")).toBe("render-failed");
    });
});

describe("hydrateMermaid — author syntax errors", () => {
    /** Mermaid rejects any source that still has a raw `;` in message text. */
    function rejectRawSemicolons(): void {
        vi.mocked(mermaid.render).mockImplementation(async (id, src) => {
            if (/:[^\n]*[^#\d]; \w/.test(src)) {
                throw new Error("Parse error on line 2:\nExpecting 'SOLID_ARROW'");
            }

            return { svg: `<svg data-id="${id}"></svg>`, diagramType: "sequence" };
        });
    }

    // Production: ";" in sequence text was the most common diagram failure.
    it("draws a sequence diagram whose message text has ';' by escaping it, noting the repair", async () => {
        rejectRawSemicolons();
        const root = mountDiagram("sequenceDiagram\nA->>B: Admit; require SAW-repair");

        await hydrateMermaid(root);

        const el = diagramOf(root);
        expect(el.getAttribute("data-mermaid-error")).toBeNull();
        expect(el.querySelector("svg")).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "diagram.renderIssue",
                properties: { outcome: "repaired" },
            }),
        ]);
    });

    it("keeps a diagram that is still broken after the repair as source, noted as content — not an extension error", async () => {
        vi.mocked(mermaid.render).mockRejectedValue(
            new Error("Parse error on line 2:\nExpecting 'NODE_STRING'"),
        );
        const root = mountDiagram("sequenceDiagram\nA->>B: still; broken-twice");

        await hydrateMermaid(root);

        const el = diagramOf(root);
        expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
        expect(el.querySelector(".emr-mermaid-fallback")).not.toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([]);
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "diagram.renderIssue",
                properties: { outcome: "syntax-error" },
            }),
        ]);
    });

    it("notes a broken diagram once, however often it is redrawn", async () => {
        vi.mocked(mermaid.render).mockRejectedValue(new Error("Parse error on line 2"));
        const root = mountDiagram("sequenceDiagram\nA->>B: noted; once");

        await hydrateMermaid(root, "Georgia, serif");
        await hydrateMermaid(root, "Verdana, sans-serif");

        expect(telemetry.current.eventNames()).toEqual(["diagram.renderIssue"]);
    });

    it("reports a runtime failure in the repaired render as an extension error", async () => {
        const runtime = new Error("Cannot read properties of undefined (reading 'x')");

        vi.mocked(mermaid.render)
            .mockRejectedValueOnce(new Error("Parse error on line 2"))
            .mockRejectedValueOnce(runtime);
        const root = mountDiagram("sequenceDiagram\nA->>B: repair; then-crash");

        await hydrateMermaid(root);

        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({ error: runtime, operation: "diagram-render" }),
        ]);
        expect(telemetry.current.events).toEqual([]);
    });

    it("notes a broken flowchart as a syntax error without retrying it", async () => {
        vi.mocked(mermaid.render).mockRejectedValue(new Error("Parse error on line 2"));
        const root = mountDiagram("flowchart LR\n  audit --> graph-no-repair");

        await hydrateMermaid(root);

        expect(mermaid.render).toHaveBeenCalledOnce();
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "diagram.renderIssue",
                properties: { outcome: "syntax-error" },
            }),
        ]);
    });
});

describe("isDiagramSyntaxError", () => {
    it.each<[string, unknown, boolean]>([
        ["a parse error", new Error("Parse error on line 3:\n…"), true],
        ["a lexical error", new Error("Lexical error on line 1."), true],
        [
            "no diagram type",
            new Error("No diagram type detected matching given configuration for text: x"),
            true,
        ],
        [
            "an unknown diagram",
            Object.assign(new Error("x"), { name: "UnknownDiagramError" }),
            true,
        ],
        ["a runtime failure", new Error("Cannot read properties of undefined"), false],
        ["a chunk failure", chunkError(), false],
        ["a non-object", "Parse error", false],
        ["null", null, false],
    ])("%s → %s", (_label, err, expected) => {
        expect(isDiagramSyntaxError(err)).toBe(expected);
    });
});

describe("hydrateMermaid — telemetry dedupe", () => {
    const runtimeFailure = () => new Error("Cannot read properties of undefined (reading 'x')");

    // Production: one broken diagram re-reported on every redraw / revisit.
    it("reports a broken diagram once, however often it is redrawn or revisited", async () => {
        vi.mocked(mermaid.render).mockRejectedValue(runtimeFailure());
        const source = "sequenceDiagram\nA->>B: dedupe broken";
        const root = mountDiagram(source);

        await hydrateMermaid(root, "Georgia, serif");
        await hydrateMermaid(root, "Verdana, sans-serif");
        document.documentElement.setAttribute("data-emr-theme", "dark");
        await hydrateMermaid(root, "Verdana, sans-serif");
        // A revisit renders the same source into a brand-new placeholder.
        await hydrateMermaid(mountDiagram(source));

        expect(telemetry.current.userFacingErrors()).toHaveLength(1);
    });

    it("reports each different broken diagram", async () => {
        vi.mocked(mermaid.render).mockRejectedValue(runtimeFailure());

        await hydrateMermaid(mountDiagram("sequenceDiagram\nA->>B: first broken"));
        await hydrateMermaid(mountDiagram("sequenceDiagram\nA->>B: second broken"));

        expect(telemetry.current.userFacingErrors()).toHaveLength(2);
    });
});

describe("isChunkLoadError", () => {
    it.each<[string, unknown, boolean]>([
        ["a webpack ChunkLoadError", chunkError(), true],
        ["a CSS chunk failure by message", new Error("Loading CSS chunk 3 failed."), true],
        ["a plain chunk failure by message", new Error("Loading chunk 9 failed."), true],
        ["a syntax error", new Error("Parse error on line 10"), false],
        ["a non-string message", { message: 42 }, false],
        ["null", null, false],
        ["a string", "Loading chunk 1 failed", false],
    ])("classifies %s", (_label, err, expected) => {
        expect(isChunkLoadError(err)).toBe(expected);
    });
});
