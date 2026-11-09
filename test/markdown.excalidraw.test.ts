import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ExcalidrawSceneError,
    isExcalidrawPath,
    parseExcalidrawScene,
} from "../src/markdown/excalidraw";
import { excalidrawSceneBytes } from "../src/shell/components/excalidrawScene.fixture";

const exportToSvgMock = vi.fn();
let libraryLoads = 0;

function mockLibrary(load: "ok" | "fail"): void {
    vi.doMock("@excalidraw/excalidraw", () => {
        libraryLoads += 1;
        if (load === "fail") throw new Error("library unavailable");

        return { exportToSvg: exportToSvgMock };
    });
}

type ExcalidrawModule = typeof import("../src/markdown/excalidraw");

// The renderer caches its library download at module level, so each render
// scenario starts from a freshly imported module with its own library mock.
async function freshModule(load: "ok" | "fail" = "ok"): Promise<ExcalidrawModule> {
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
    libraryLoads = 0;
    delete assetWindow.EXCALIDRAW_ASSET_PATH;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("isExcalidrawPath", () => {
    it.each([
        ["/docs/flow.excalidraw", true],
        ["/docs/flow.EXCALIDRAW.json", true],
        ["/docs/flow.excalidraw.svg", false],
        ["/docs/flow.json", false],
    ])("treats %s as a drawing: %s", (path, expected) => {
        expect(isExcalidrawPath(path)).toBe(expected);
    });
});

describe("parseExcalidrawScene", () => {
    it("keeps live elements, files, and the canvas colour", () => {
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

    it("defaults the canvas colour and files when the scene has invalid ones", () => {
        expect(
            parseExcalidrawScene(
                JSON.stringify({
                    type: "excalidraw",
                    elements: [],
                    appState: { viewBackgroundColor: 7 },
                    files: [],
                }),
            ),
        ).toEqual({
            elements: [],
            files: null,
            viewBackgroundColor: "#ffffff",
        });
    });

    it("defaults the canvas colour and files when the scene omits them", () => {
        expect(parseExcalidrawScene('{"type":"excalidraw","elements":[]}')).toEqual({
            elements: [],
            files: null,
            viewBackgroundColor: "#ffffff",
        });
    });

    it.each([
        ["malformed JSON", "{", "Excalidraw file is not valid JSON"],
        ["a JSON array", "[]", "File is not an Excalidraw scene"],
        [
            "a library file",
            '{"type":"excalidrawlib","elements":[]}',
            "File is not an Excalidraw scene",
        ],
        ["missing elements", '{"type":"excalidraw"}', "File is not an Excalidraw scene"],
    ])("rejects %s as a scene error", (_label, text, message) => {
        expect(() => parseExcalidrawScene(text)).toThrow(ExcalidrawSceneError);
        expect(() => parseExcalidrawScene(text)).toThrow(
            expect.objectContaining({ name: "ExcalidrawSceneError", message }),
        );
    });
});

describe("renderExcalidrawSvgBlob", () => {
    it("exports the scene as a light-mode SVG blob", async () => {
        const { renderExcalidrawSvgBlob } = await freshModule();
        const blob = await renderExcalidrawSvgBlob(excalidrawSceneBytes());

        expect(blob.type).toBe("image/svg+xml");
        expect(await readBlob(blob)).toContain('viewBox="0 0 480 112"');
        expect(exportToSvgMock).toHaveBeenCalledWith({
            elements: ["doc", "doc-label", "review", "review-label", "flow"].map((id) =>
                expect.objectContaining({ id }),
            ),
            files: {},
            exportPadding: 16,
            appState: {
                exportBackground: true,
                exportEmbedScene: false,
                exportWithDarkMode: false,
                viewBackgroundColor: "#ffffff",
            },
        });
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

    it("downloads the library once for several drawings", async () => {
        const { renderExcalidrawSvgBlob } = await freshModule();
        await renderExcalidrawSvgBlob(excalidrawSceneBytes());
        await renderExcalidrawSvgBlob(excalidrawSceneBytes());

        expect(exportToSvgMock).toHaveBeenCalledTimes(2);
        expect(libraryLoads).toBe(1);
    });

    it("rejects a non-scene file without downloading the library", async () => {
        const { renderExcalidrawSvgBlob, ExcalidrawSceneError } = await freshModule();

        await expect(
            renderExcalidrawSvgBlob(new TextEncoder().encode("nope").buffer),
        ).rejects.toBeInstanceOf(ExcalidrawSceneError);
        expect(libraryLoads).toBe(0);
    });

    it("retries the library load after a failure", async () => {
        const { renderExcalidrawSvgBlob } = await freshModule("fail");
        await expect(renderExcalidrawSvgBlob(excalidrawSceneBytes())).rejects.toThrow();

        mockLibrary("ok");
        const blob = await renderExcalidrawSvgBlob(excalidrawSceneBytes());
        expect(blob.type).toBe("image/svg+xml");
    });
});
