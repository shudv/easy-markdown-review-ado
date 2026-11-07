import { describe, expect, it, vi } from "vitest";

import {
    hydrateDocumentImages,
    repositoryImageMimeType,
    resolveRepositoryImagePath,
} from "../src/markdown/documentImages";
import { ExcalidrawSceneError } from "../src/markdown/excalidraw";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

function mountImage(src: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = `<img src="${src}" alt="Image">`;

    return root;
}

describe("repositoryImageMimeType", () => {
    it.each([
        ["/assets/photo.avif", "image/avif"],
        ["/assets/legacy.bmp", "image/bmp"],
        ["/assets/diagram.SVG", "image/svg+xml"],
        ["/assets/favicon.ico", "image/x-icon"],
        ["/assets/photo.jpeg", "image/jpeg"],
        ["/assets/photo.jpg", "image/jpeg"],
        ["/assets/tour.gif", "image/gif"],
        ["/assets/screenshot.png", "image/png"],
        ["/assets/screenshot.webp", "image/webp"],
    ])("serves %s as %s", (path, mimeType) => {
        expect(repositoryImageMimeType(path)).toBe(mimeType);
    });

    it("falls back to a generic binary type for a file without a known extension", () => {
        expect(repositoryImageMimeType("/assets/no-extension")).toBe("application/octet-stream");
    });
});

describe("resolveRepositoryImagePath", () => {
    it.each([
        {
            name: "a sibling file",
            doc: "/docs/guide.md",
            src: "diagram.png",
            expected: "/docs/diagram.png",
        },
        {
            name: "a parent-relative path",
            doc: "/docs/guides/install.md",
            src: "../../assets/a.svg",
            expected: "/assets/a.svg",
        },
        {
            name: "a repository-root path",
            doc: "docs/guide.md",
            src: "/assets/root.png",
            expected: "/assets/root.png",
        },
        {
            name: "an encoded path with a query and fragment",
            doc: "/docs/guide.md",
            src: "./my%20diagram.png?raw=1#x",
            expected: "/docs/my diagram.png",
        },
        {
            name: "a bare relative path containing a colon",
            doc: "/docs/guide.md",
            src: "assets/name:variant.png",
            expected: "/docs/assets/name:variant.png",
        },
    ])("resolves $name against the document's folder", ({ doc, src, expected }) => {
        expect(resolveRepositoryImagePath(doc, src)).toBe(expected);
    });

    it.each([
        { name: "an external URL", src: "https://example.com/a.png" },
        { name: "a protocol-relative URL", src: "//example.com/a.png" },
        { name: "a fragment", src: "#diagram" },
        { name: "a blank source", src: "  " },
        { name: "a malformed percent sequence", src: "%zz" },
    ])("does not treat $name as a repository image", ({ src }) => {
        expect(resolveRepositoryImagePath("/docs/guide.md", src)).toBeNull();
    });
});

describe("hydrateDocumentImages", () => {
    it("shows a repository image as loading until its object URL has loaded", async () => {
        const root = mountImage("../assets/diagram.svg");
        const resolveImage = vi.fn().mockResolvedValue("blob:repository-image");

        hydrateDocumentImages(root, "/docs/guide.md", resolveImage);
        const image = root.querySelector<HTMLImageElement>("img")!;
        const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;

        expect(resolveImage).toHaveBeenCalledWith("/assets/diagram.svg");
        expect(image.hasAttribute("src")).toBe(false);
        expect(image.getAttribute("aria-busy")).toBe("true");
        expect(frame.classList.contains("is-loading")).toBe(true);
        expect(image.classList.contains("is-loading")).toBe(true);

        await vi.waitFor(() => expect(image.src).toBe("blob:repository-image"));
        image.dispatchEvent(new Event("load"));

        expect(image.getAttribute("aria-busy")).toBeNull();
        expect(frame.classList.contains("is-loading")).toBe(false);
    });

    it("leaves external images untouched", () => {
        const root = mountImage("https://example.com/external.png");

        hydrateDocumentImages(root, "/docs/guide.md", vi.fn());

        expect(root.querySelector(".emr-repo-image-frame")).toBeNull();
        expect(root.querySelector("img")!.src).toBe("https://example.com/external.png");
    });

    it("shows an image the repository has no content for as unavailable and reports it", async () => {
        const root = mountImage("./missing.png");

        hydrateDocumentImages(root, "/docs/guide.md", async () => undefined);

        const image = root.querySelector<HTMLImageElement>("img")!;
        const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
        await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));
        expect(frame.classList.contains("is-loading")).toBe(false);
        expect(frame.dataset.imagePath).toBe("/docs/missing.png");
        expect(image.getAttribute("aria-busy")).toBeNull();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "Repository image not available" }),
                source: "DocumentImage.hydrate",
                operation: "repository-image-load",
                impact: "degraded",
            }),
        ]);
    });

    it("shows an unavailable state and reports it when the repository resolver rejects", async () => {
        const root = mountImage("./broken.png");

        hydrateDocumentImages(root, "/docs/guide.md", async () => {
            throw new Error("repository unavailable");
        });

        const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
        await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "repository unavailable" }),
                operation: "repository-image-load",
            }),
        ]);
    });

    it("reports an image that fetched but can't be displayed", async () => {
        const root = mountImage("./not-an-image.png");
        hydrateDocumentImages(root, "/docs/guide.md", async () => "blob:x");
        const image = root.querySelector<HTMLImageElement>("img")!;
        await vi.waitFor(() => expect(image.src).toBe("blob:x"));

        image.dispatchEvent(new Event("error"));

        expect(root.querySelector(".emr-repo-image-frame")!.classList.contains("is-error")).toBe(
            true,
        );
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({
                    message: "Repository image couldn't be displayed",
                }),
            }),
        ]);
    });

    it("reports a broken image once even when the browser also fires an error for it", async () => {
        const root = mountImage("./missing.png");
        hydrateDocumentImages(root, "/docs/guide.md", async () => undefined);
        const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
        await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));

        root.querySelector("img")!.dispatchEvent(new Event("error"));

        expect(telemetry.current.userFacingErrors()).toHaveLength(1);
    });

    it("stops updating an image's frame once the document is cleaned up", async () => {
        const root = mountImage("./diagram.png");
        const cleanup = hydrateDocumentImages(root, "/docs/guide.md", async () => "blob:x");
        const image = root.querySelector<HTMLImageElement>("img")!;
        const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
        await vi.waitFor(() => expect(image.src).toBe("blob:x"));

        cleanup();
        image.dispatchEvent(new Event("load"));
        image.dispatchEvent(new Event("error"));

        expect(frame.className).toBe("emr-repo-image-frame is-loading");
        expect(image.getAttribute("aria-busy")).toBe("true");
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("ignores an image that resolves after the document was cleaned up", async () => {
        const root = mountImage("./late.png");
        let resolve!: (value: string) => void;

        const pending = new Promise<string>((done) => {
            resolve = done;
        });

        const cleanup = hydrateDocumentImages(root, "/docs/guide.md", () => pending);
        const image = root.querySelector<HTMLImageElement>("img")!;

        cleanup();
        resolve("blob:late");
        await pending;
        await Promise.resolve();

        expect(image.hasAttribute("src")).toBe(false);
    });

    // A broken image link in the author's Markdown is content health.
    it.each([
        ["TF401174", new Error("TF401174: The item '/docs/gone.png' could not be found.")],
        ["a 404", Object.assign(new Error("Not Found"), { status: 404 })],
        [
            "an invalid Excalidraw scene",
            new ExcalidrawSceneError("File is not an Excalidraw scene"),
        ],
    ])(
        "shows a missing repository image (%s) as unavailable without reporting it",
        async (_label, failure) => {
            const root = mountImage("./gone.png");
            hydrateDocumentImages(root, "/docs/guide.md", async () => {
                throw failure;
            });

            const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;

            await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));
            expect(frame.dataset.imagePath).toBe("/docs/gone.png");
            expect(telemetry.current.userFacingErrors()).toEqual([]);
        },
    );

    it("tags Excalidraw drawings for the dark-mode filter", () => {
        const root = document.createElement("div");
        root.innerHTML = [
            '<img src="./flow.excalidraw" alt="Flow">',
            '<img src="./flow.Excalidraw.json" alt="Flow JSON">',
            '<img src="./photo.png" alt="Photo">',
        ].join("");
        hydrateDocumentImages(root, "/docs/guide.md", async () => "blob:x");

        const tagged = [...root.querySelectorAll("img")].map((image) =>
            image.classList.contains("emr-excalidraw"),
        );

        expect(tagged).toEqual([true, true, false]);
    });
});
