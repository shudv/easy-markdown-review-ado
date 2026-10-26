// @vitest-environment jsdom

import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

// Mock the `mermaid` module BEFORE importing the SUT so the dynamic
// `import("mermaid")` inside `hydrateMermaid` resolves to our stub.
vi.mock("mermaid", () => {
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn(async (id: string, src: string) => {
        return { svg: `<svg data-id="${id}" data-src="${src.length}"></svg>` };
      }),
    },
  };
});

import mermaid from "mermaid";
import { isChunkLoadError } from "../src/markdown/chunkRetry";
import {
  hydrateMermaid,
  isDiagramSyntaxError,
} from "../src/markdown/mermaidHydrate";

const trackUserFacingErrorMock = vi.fn();
const trackMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
    track: (...args: unknown[]) => trackMock(...args),
  };
});

describe("hydrateMermaid", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-emr-theme");
    trackUserFacingErrorMock.mockClear();
  });

  it("returns immediately when no placeholders are present", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>nothing to hydrate</p>";
    document.body.appendChild(root);
    await expect(hydrateMermaid(root)).resolves.toBeUndefined();
  });

  it("hydrates placeholders into SVG and marks them as hydrated", async () => {
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML =
      `<div class="emr-mermaid" data-mermaid-src="${src}">` +
      '<pre class="emr-mermaid-fallback">graph TD\nA-->B</pre>' +
      "</div>";
    document.body.appendChild(root);

    const readerFont = 'Georgia, "Times New Roman", serif';
    await hydrateMermaid(root, readerFont);

    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    expect(el.getAttribute("data-hydrated")).toBe("true");
    expect(el.innerHTML).toContain("<svg");
    // No `data-emr-theme` → mermaid initialized + tagged with the light theme.
    expect(el.getAttribute("data-mermaid-theme")).toBe("default");
    // Diagrams are drawn at the reader's prose size (not Mermaid's 16px default)
    // so they don't tower over the body copy.
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: "default",
        fontSize: 14,
        fontFamily: readerFont,
      }),
    );
    expect(el.getAttribute("data-mermaid-font")).toBe(readerFont);
  });

  it("scales the diagram from its viewBox: captures the natural width and strips Mermaid's inline size caps", async () => {
    // A realistic Mermaid SVG carries a viewBox plus its own width/height and an
    // inline max-width cap.
    vi.mocked(mermaid.render).mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 400 200" width="400" height="200" style="max-width: 400px"></svg>',
    });
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${src}"></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root);

    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    // The natural width (the viewBox's 3rd value) drives the reader-scale sizing.
    expect(el.style.getPropertyValue("--emr-diagram-natural-w")).toBe("400px");
    const svg = el.querySelector("svg")!;
    // Mermaid's own inline size caps are stripped so the stylesheet governs the
    // size (scaled by `--emr-reader-scale`, capped at the reading column).
    expect(svg.hasAttribute("width")).toBe(false);
    expect(svg.hasAttribute("height")).toBe(false);
    expect(svg.style.maxWidth).toBe("");
  });

  it("skips placeholders already hydrated in the current theme", async () => {
    const root = document.createElement("div");
    const readerFont = 'Georgia, "Times New Roman", serif';
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="x" data-hydrated="true" data-mermaid-theme="default"><pre>old</pre></div>`;
    root
      .querySelector(".emr-mermaid")!
      .setAttribute("data-mermaid-font", readerFont);
    document.body.appendChild(root);

    await hydrateMermaid(root, readerFont);

    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    // Untouched — the pre is still there.
    expect(el.innerHTML).toBe("<pre>old</pre>");
  });

  it("re-renders a diagram when the reader font changes", async () => {
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${src}"></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root, "Georgia, serif");
    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    const georgiaHtml = el.innerHTML;

    await hydrateMermaid(root, "Verdana, sans-serif");

    expect(el.getAttribute("data-mermaid-font")).toBe("Verdana, sans-serif");
    expect(el.innerHTML).not.toBe(georgiaHtml);
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontFamily: "Verdana, sans-serif" }),
    );
  });

  it("skips placeholders whose data-mermaid-src is empty", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src=""></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root);
    // No throw is the contract; element stays effectively empty.
    expect((root.querySelector(".emr-mermaid") as HTMLElement).innerHTML).toBe(
      "",
    );
  });

  it("skips a placeholder whose source is not decodable", async () => {
    const root = document.createElement("div");
    // A lone `%` is an invalid percent-escape → decodeURIComponent throws.
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="%"></div>`;
    document.body.appendChild(root);

    await expect(hydrateMermaid(root)).resolves.toBeUndefined();
    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    // Undecodable source is silently skipped — never marked hydrated.
    expect(el.getAttribute("data-hydrated")).toBeNull();
    expect(el.innerHTML).toBe("");
  });

  it("renders in the dark theme when the reader is dark", async () => {
    document.documentElement.setAttribute("data-emr-theme", "dark");
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${src}"></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root);

    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    expect(el.getAttribute("data-mermaid-theme")).toBe("dark");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });

  it("re-renders a diagram drawn in a different theme (light→dark)", async () => {
    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML = `<div class="emr-mermaid" data-mermaid-src="${src}"></div>`;
    document.body.appendChild(root);

    // First pass: light.
    await hydrateMermaid(root);
    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    expect(el.getAttribute("data-mermaid-theme")).toBe("default");
    const lightHtml = el.innerHTML;

    // Flip to dark and re-hydrate — the diagram redraws in the dark theme.
    document.documentElement.setAttribute("data-emr-theme", "dark");
    await hydrateMermaid(root);
    expect(el.getAttribute("data-mermaid-theme")).toBe("dark");
    expect(el.innerHTML).not.toBe(lightHtml);
  });

  it("flags a placeholder as render-failed when mermaid.render rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("bad graph"));

    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML =
      `<div class="emr-mermaid" data-mermaid-src="${src}">` +
      `<pre class="emr-mermaid-fallback">graph TD</pre></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root);

    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
    expect(el.getAttribute("data-hydrated")).toBe("true");
    // The readable fallback is preserved for the user.
    expect(el.innerHTML).toContain("emr-mermaid-fallback");
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: "bad graph" }),
      source: "Mermaid.hydrate",
      operation: "diagram-render",
      impact: "degraded",
    });
    warn.mockRestore();
  });

  it("clears a prior render error when a later redraw succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("bad graph"));

    const root = document.createElement("div");
    const src = encodeURIComponent("graph TD\nA-->B");
    root.innerHTML =
      `<div class="emr-mermaid" data-mermaid-src="${src}">` +
      `<pre class="emr-mermaid-fallback">graph TD</pre></div>`;
    document.body.appendChild(root);

    await hydrateMermaid(root, "Georgia, serif");
    const el = root.querySelector(".emr-mermaid") as HTMLElement;
    expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");

    await hydrateMermaid(root, "Verdana, sans-serif");

    expect(el.getAttribute("data-mermaid-error")).toBeNull();
    expect(el.getAttribute("data-mermaid-font")).toBe("Verdana, sans-serif");
    expect(el.innerHTML).toContain("<svg");
    expect(el.innerHTML).not.toContain("emr-mermaid-fallback");
    warn.mockRestore();
  });
});

function chunkError(): Error {
  return Object.assign(new Error("Loading chunk 812 failed.\n(error: x)"), {
    name: "ChunkLoadError",
  });
}

function mountDiagram(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML =
    `<div class="emr-mermaid" data-mermaid-src="${encodeURIComponent(source)}">` +
    `<pre class="emr-mermaid-fallback">${source}</pre></div>`;
  document.body.appendChild(root);
  return root;
}

describe("hydrateMermaid — transient chunk failures", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    trackUserFacingErrorMock.mockClear();
    vi.mocked(mermaid.render).mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  // Production: 20 ChunkLoadErrors in 15 sessions left diagrams as raw source.
  it("retries a ChunkLoadError and renders once the chunk loads", async () => {
    vi.mocked(mermaid.render)
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError());
    const root = mountDiagram("sequenceDiagram\nA->>B: chunk-retry-ok");

    const pass = hydrateMermaid(root);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    await pass;

    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(mermaid.render).toHaveBeenCalledTimes(3);
    expect(el.getAttribute("data-mermaid-error")).toBeNull();
    expect(el.innerHTML).toContain("<svg");
    expect(trackUserFacingErrorMock).not.toHaveBeenCalled();
    // Every attempt gets a fresh DOM id.
    const ids = vi.mocked(mermaid.render).mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(3);
  });

  it("gives up after the retries and keeps the readable fallback", async () => {
    vi.mocked(mermaid.render)
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError());
    const root = mountDiagram("sequenceDiagram\nA->>B: chunk-retry-exhausted");

    const pass = hydrateMermaid(root);
    await vi.advanceTimersByTimeAsync(4_000);
    await pass;

    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(mermaid.render).toHaveBeenCalledTimes(3);
    expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
    expect(el.innerHTML).toContain("emr-mermaid-fallback");
    expect(trackUserFacingErrorMock).toHaveBeenCalledOnce();
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ name: "ChunkLoadError" }),
        operation: "diagram-render",
      }),
    );
  });

  it("does not retry a syntax error", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(
      new Error("Parse error on line 2"),
    );
    const root = mountDiagram("sequenceDiagram\nA->>B broken arrow");

    await hydrateMermaid(root);

    expect(mermaid.render).toHaveBeenCalledOnce();
    expect(
      root.querySelector(".emr-mermaid")!.getAttribute("data-mermaid-error"),
    ).toBe("render-failed");
  });
});

describe("hydrateMermaid — author syntax errors", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const defaultRender = vi.mocked(mermaid.render).getMockImplementation()!;

  beforeEach(() => {
    document.body.innerHTML = "";
    trackUserFacingErrorMock.mockClear();
    trackMock.mockClear();
    vi.mocked(mermaid.render).mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(mermaid.render).mockReset();
    vi.mocked(mermaid.render).mockImplementation(defaultRender);
    warn.mockRestore();
  });

  /** Mermaid rejects any source that still has a raw `;` in message text. */
  function rejectRawSemicolons(): void {
    vi.mocked(mermaid.render).mockImplementation(async (id, src) => {
      if (/:[^\n]*[^#\d]; \w/.test(src)) {
        throw new Error("Parse error on line 2:\nExpecting 'SOLID_ARROW'");
      }
      return { svg: `<svg data-id="${id}"></svg>` };
    });
  }

  // Production: ";" in sequence text was the most common diagram failure.
  it("renders a sequence diagram whose text has ';' by escaping it, without reporting an error", async () => {
    rejectRawSemicolons();
    const source = "sequenceDiagram\nA->>B: Admit; require SAW-repair";
    const root = mountDiagram(source);

    await hydrateMermaid(root);

    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    expect(el.getAttribute("data-mermaid-error")).toBeNull();
    expect(el.innerHTML).toContain("<svg");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mermaid.render).mock.calls[1]![1]).toContain(
      "Admit#59; require",
    );
    expect(trackUserFacingErrorMock).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith({
      name: "diagram.renderIssue",
      properties: { outcome: "repaired" },
    });
  });

  it("keeps a genuinely broken diagram as source, noted as content — not an extension error", async () => {
    vi.mocked(mermaid.render).mockRejectedValue(
      new Error("Parse error on line 2:\nExpecting 'NODE_STRING'"),
    );
    const root = mountDiagram("sequenceDiagram\nA->>B: still; broken-twice");

    await hydrateMermaid(root);

    const el = root.querySelector<HTMLElement>(".emr-mermaid")!;
    // The repair was tried once, then the author's original error stands.
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(el.getAttribute("data-mermaid-error")).toBe("render-failed");
    expect(el.innerHTML).toContain("emr-mermaid-fallback");
    expect(trackUserFacingErrorMock).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith({
      name: "diagram.renderIssue",
      properties: { outcome: "syntax-error" },
    });

    // A redraw doesn't note it again.
    await hydrateMermaid(root, "Verdana, sans-serif");
    expect(trackMock).toHaveBeenCalledOnce();
  });

  it("reports a runtime failure in the repaired render as an extension error", async () => {
    const runtime = new Error(
      "Cannot read properties of undefined (reading 'x')",
    );
    vi.mocked(mermaid.render)
      .mockRejectedValueOnce(new Error("Parse error on line 2"))
      .mockRejectedValueOnce(runtime);
    const root = mountDiagram("sequenceDiagram\nA->>B: repair; then-crash");

    await hydrateMermaid(root);

    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: runtime, operation: "diagram-render" }),
    );
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("doesn't rewrite a broken diagram that has nothing to repair", async () => {
    vi.mocked(mermaid.render).mockRejectedValue(
      new Error("Parse error on line 2"),
    );
    const root = mountDiagram("flowchart LR\n  audit --> graph-no-repair");

    await hydrateMermaid(root);

    expect(mermaid.render).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith({
      name: "diagram.renderIssue",
      properties: { outcome: "syntax-error" },
    });
  });
});

describe("isDiagramSyntaxError", () => {
  it.each<[string, unknown, boolean]>([
    ["a parse error", new Error("Parse error on line 3:\n…"), true],
    ["a lexical error", new Error("Lexical error on line 1."), true],
    [
      "no diagram type",
      new Error(
        "No diagram type detected matching given configuration for text: x",
      ),
      true,
    ],
    [
      "an unknown diagram",
      Object.assign(new Error("x"), { name: "UnknownDiagramError" }),
      true,
    ],
    [
      "a runtime failure",
      new Error("Cannot read properties of undefined"),
      false,
    ],
    ["a chunk failure", chunkError(), false],
    ["a non-object", "Parse error", false],
    ["null", null, false],
  ])("%s → %s", (_label, err, expected) => {
    expect(isDiagramSyntaxError(err)).toBe(expected);
  });
});

describe("hydrateMermaid — telemetry dedupe", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-emr-theme");
    trackUserFacingErrorMock.mockClear();
    vi.mocked(mermaid.render).mockClear();
  });

  // Production: one broken diagram re-reported on every redraw / revisit.
  it("reports a broken diagram once, however often it is redrawn or revisited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = "sequenceDiagram\nA->>B: dedupe broken";
    const defaultRender = vi.mocked(mermaid.render).getMockImplementation()!;
    // A runtime failure (not an author syntax error, which is content health).
    vi.mocked(mermaid.render).mockRejectedValue(
      new Error("Cannot read properties of undefined (reading 'x')"),
    );
    try {
      const root = mountDiagram(source);
      await hydrateMermaid(root, "Georgia, serif");
      await hydrateMermaid(root, "Verdana, sans-serif");
      document.documentElement.setAttribute("data-emr-theme", "dark");
      await hydrateMermaid(root, "Verdana, sans-serif");
      // A revisit renders the same source into a brand-new placeholder.
      await hydrateMermaid(mountDiagram(source));
      expect(mermaid.render).toHaveBeenCalledTimes(4);
      expect(trackUserFacingErrorMock).toHaveBeenCalledOnce();

      // A different broken diagram is still reported.
      await hydrateMermaid(
        mountDiagram("sequenceDiagram\nA->>B: other broken"),
      );
      expect(trackUserFacingErrorMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(mermaid.render).mockReset();
      vi.mocked(mermaid.render).mockImplementation(defaultRender);
      warn.mockRestore();
    }
  });
});

describe("isChunkLoadError", () => {
  it.each<[string, unknown, boolean]>([
    ["a webpack ChunkLoadError", chunkError(), true],
    [
      "a CSS chunk failure by message",
      new Error("Loading CSS chunk 3 failed."),
      true,
    ],
    [
      "a plain chunk failure by message",
      new Error("Loading chunk 9 failed."),
      true,
    ],
    ["a syntax error", new Error("Parse error on line 10"), false],
    ["a non-string message", { message: 42 }, false],
    ["null", null, false],
    ["a string", "Loading chunk 1 failed", false],
  ])("classifies %s", (_label, err, expected) => {
    expect(isChunkLoadError(err)).toBe(expected);
  });
});
