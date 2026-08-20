// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";

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
import { hydrateMermaid } from "../src/markdown/mermaidHydrate";

describe("hydrateMermaid", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-emr-theme");
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
