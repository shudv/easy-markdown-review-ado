import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { excalidrawSceneBytes } from "../src/shell/components/excalidrawScene.fixture";

const exportToSvgMock = vi.fn();

function mockLibrary(load: "ok" | "fail"): void {
  vi.doMock("@excalidraw/excalidraw", () => {
    if (load === "fail") throw new Error("library unavailable");
    return { exportToSvg: exportToSvgMock };
  });
}

type ExcalidrawModule = typeof import("../src/markdown/excalidraw");

async function freshModule(
  load: "ok" | "fail" = "ok",
): Promise<ExcalidrawModule> {
  vi.resetModules();
  mockLibrary(load);
  return import("../src/markdown/excalidraw");
}

// jsdom's Blob has no `.text()`.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

function svgElement(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 480 112");
  return svg;
}

const assetWindow = window as Window & { EXCALIDRAW_ASSET_PATH?: string };

beforeEach(() => {
  exportToSvgMock.mockReset().mockResolvedValue(svgElement());
  delete assetWindow.EXCALIDRAW_ASSET_PATH;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isExcalidrawPath", () => {
  it("matches .excalidraw and .excalidraw.json files only", async () => {
    const { isExcalidrawPath } = await freshModule();
    expect(isExcalidrawPath("/docs/flow.excalidraw")).toBe(true);
    expect(isExcalidrawPath("/docs/flow.EXCALIDRAW.json")).toBe(true);
    expect(isExcalidrawPath("/docs/flow.excalidraw.svg")).toBe(false);
    expect(isExcalidrawPath("/docs/flow.json")).toBe(false);
  });
});

describe("parseExcalidrawScene", () => {
  it("keeps live elements, files, and the canvas colour", async () => {
    const { parseExcalidrawScene } = await freshModule();
    const scene = parseExcalidrawScene(
      JSON.stringify({
        type: "excalidraw",
        elements: [
          { id: "a", isDeleted: false },
          { id: "gone", isDeleted: true },
          null,
          ["not", "an", "element"],
        ],
        appState: { viewBackgroundColor: "#fdf6e3" },
        files: { img: { id: "img" } },
      }),
    );
    expect(scene).toEqual({
      elements: [{ id: "a", isDeleted: false }],
      files: { img: { id: "img" } },
      viewBackgroundColor: "#fdf6e3",
    });
  });

  it("defaults the canvas colour and files when the scene omits them", async () => {
    const { parseExcalidrawScene } = await freshModule();
    expect(
      parseExcalidrawScene(
        JSON.stringify({
          type: "excalidraw",
          elements: [],
          appState: { viewBackgroundColor: 7 },
          files: [],
        }),
      ),
    ).toEqual({ elements: [], files: null, viewBackgroundColor: "#ffffff" });
    expect(parseExcalidrawScene('{"type":"excalidraw","elements":[]}')).toEqual(
      { elements: [], files: null, viewBackgroundColor: "#ffffff" },
    );
  });

  it.each([
    ["malformed JSON", "{", "Excalidraw file is not valid JSON"],
    ["a JSON array", "[]", "File is not an Excalidraw scene"],
    [
      "a library file",
      '{"type":"excalidrawlib","elements":[]}',
      "File is not an Excalidraw scene",
    ],
    [
      "missing elements",
      '{"type":"excalidraw"}',
      "File is not an Excalidraw scene",
    ],
  ])("rejects %s as a scene error", async (_label, text, message) => {
    const { parseExcalidrawScene, ExcalidrawSceneError } = await freshModule();
    let caught: unknown;
    try {
      parseExcalidrawScene(text);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExcalidrawSceneError);
    expect(caught).toMatchObject({ name: "ExcalidrawSceneError", message });
  });
});

describe("renderExcalidrawSvgBlob", () => {
  it("exports the scene as a light-mode SVG blob", async () => {
    const { renderExcalidrawSvgBlob } = await freshModule();
    const blob = await renderExcalidrawSvgBlob(excalidrawSceneBytes());

    expect(blob.type).toBe("image/svg+xml");
    expect(await readBlob(blob)).toContain('viewBox="0 0 480 112"');
    const input = exportToSvgMock.mock.calls[0]![0];
    expect(input.appState).toEqual({
      exportBackground: true,
      exportEmbedScene: false,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    });
    expect(input.exportPadding).toBe(16);
    expect(input.files).toEqual({});
    expect(input.elements.map((el: { id: string }) => el.id)).toEqual([
      "doc",
      "doc-label",
      "review",
      "review-label",
      "flow",
    ]);
  });

  it("serves fonts from the bundle when webpack provides a public path", async () => {
    vi.stubGlobal("__webpack_public_path__", "https://cdn.example/dist/");
    const { renderExcalidrawSvgBlob } = await freshModule();
    await renderExcalidrawSvgBlob(excalidrawSceneBytes());
    expect(assetWindow.EXCALIDRAW_ASSET_PATH).toBe(
      "https://cdn.example/dist/excalidraw-assets/",
    );
  });

  it("leaves the asset path alone outside a webpack build", async () => {
    const { renderExcalidrawSvgBlob } = await freshModule();
    await renderExcalidrawSvgBlob(excalidrawSceneBytes());
    expect(assetWindow.EXCALIDRAW_ASSET_PATH).toBeUndefined();
  });

  it("loads the library once across renders", async () => {
    const { renderExcalidrawSvgBlob } = await freshModule();
    vi.stubGlobal("__webpack_public_path__", "https://cdn.example/");
    await renderExcalidrawSvgBlob(excalidrawSceneBytes());
    assetWindow.EXCALIDRAW_ASSET_PATH = "untouched";
    await renderExcalidrawSvgBlob(excalidrawSceneBytes());
    expect(exportToSvgMock).toHaveBeenCalledTimes(2);
    expect(assetWindow.EXCALIDRAW_ASSET_PATH).toBe("untouched");
  });

  it("rejects a non-scene file before loading the library", async () => {
    const { renderExcalidrawSvgBlob, ExcalidrawSceneError } =
      await freshModule("fail");
    await expect(
      renderExcalidrawSvgBlob(new TextEncoder().encode("nope").buffer),
    ).rejects.toBeInstanceOf(ExcalidrawSceneError);
  });

  it("retries the library load after a failure", async () => {
    const { renderExcalidrawSvgBlob } = await freshModule("fail");
    await expect(
      renderExcalidrawSvgBlob(excalidrawSceneBytes()),
    ).rejects.toThrow();

    mockLibrary("ok");
    const blob = await renderExcalidrawSvgBlob(excalidrawSceneBytes());
    expect(blob.type).toBe("image/svg+xml");
  });
});
