import { describe, expect, it, vi } from "vitest";

import {
  hydrateDocumentImages,
  repositoryImageMimeType,
  resolveRepositoryImagePath,
} from "../src/markdown/documentImages";

const trackUserFacingErrorMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return {
    ...actual,
    trackUserFacingError: (...args: unknown[]) =>
      trackUserFacingErrorMock(...args),
  };
});

describe("repositoryImageMimeType", () => {
  it("recognizes browser image formats and falls back safely", () => {
    expect(repositoryImageMimeType("/assets/photo.avif")).toBe("image/avif");
    expect(repositoryImageMimeType("/assets/legacy.bmp")).toBe("image/bmp");
    expect(repositoryImageMimeType("/assets/diagram.SVG")).toBe(
      "image/svg+xml",
    );
    expect(repositoryImageMimeType("/assets/favicon.ico")).toBe("image/x-icon");
    expect(repositoryImageMimeType("/assets/photo.jpeg")).toBe("image/jpeg");
    expect(repositoryImageMimeType("/assets/photo.jpg")).toBe("image/jpeg");
    expect(repositoryImageMimeType("/assets/tour.gif")).toBe("image/gif");
    expect(repositoryImageMimeType("/assets/screenshot.png")).toBe("image/png");
    expect(repositoryImageMimeType("/assets/screenshot.webp")).toBe(
      "image/webp",
    );
    expect(repositoryImageMimeType("/assets/no-extension")).toBe(
      "application/octet-stream",
    );
  });
});

describe("resolveRepositoryImagePath", () => {
  it("resolves sibling, parent, root, encoded, and bare relative paths", () => {
    expect(resolveRepositoryImagePath("/docs/guide.md", "diagram.png")).toBe(
      "/docs/diagram.png",
    );
    expect(
      resolveRepositoryImagePath(
        "/docs/guides/install.md",
        "../../assets/a.svg",
      ),
    ).toBe("/assets/a.svg");
    expect(
      resolveRepositoryImagePath("docs/guide.md", "/assets/root.png"),
    ).toBe("/assets/root.png");
    expect(
      resolveRepositoryImagePath(
        "/docs/guide.md",
        "./my%20diagram.png?raw=1#x",
      ),
    ).toBe("/docs/my diagram.png");
    expect(
      resolveRepositoryImagePath("/docs/guide.md", "assets/name:variant.png"),
    ).toBe("/docs/assets/name:variant.png");
  });

  it("rejects external, protocol-relative, fragment, empty, and malformed paths", () => {
    expect(
      resolveRepositoryImagePath("/docs/guide.md", "https://example.com/a.png"),
    ).toBeNull();
    expect(
      resolveRepositoryImagePath("/docs/guide.md", "//example.com/a.png"),
    ).toBeNull();
    expect(resolveRepositoryImagePath("/docs/guide.md", "#diagram")).toBeNull();
    expect(resolveRepositoryImagePath("/docs/guide.md", "  ")).toBeNull();
    expect(resolveRepositoryImagePath("/docs/guide.md", "%zz")).toBeNull();
  });
});

describe("hydrateDocumentImages", () => {
  it("replaces repository images with resolved object URLs", async () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<img src="../assets/diagram.svg" alt="Architecture">',
      '<img src="https://example.com/external.png" alt="External">',
    ].join("");
    const resolveImage = vi.fn().mockResolvedValue("blob:repository-image");

    hydrateDocumentImages(root, "/docs/guide.md", resolveImage);
    const images = root.querySelectorAll<HTMLImageElement>("img");
    const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;

    expect(images[0]!.hasAttribute("src")).toBe(false);
    expect(images[0]!.getAttribute("aria-busy")).toBe("true");
    expect(frame.classList.contains("is-loading")).toBe(true);
    expect(images[0]!.classList.contains("is-loading")).toBe(true);
    await vi.waitFor(() =>
      expect(images[0]!.src).toBe("blob:repository-image"),
    );
    images[0]!.dispatchEvent(new Event("load"));
    expect(resolveImage).toHaveBeenCalledWith("/assets/diagram.svg");
    expect(images[0]!.getAttribute("aria-busy")).toBeNull();
    expect(frame.classList.contains("is-loading")).toBe(false);
    expect(images[1]!.src).toBe("https://example.com/external.png");
  });

  it("shows an unavailable state and ignores late results after cleanup", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<img src="./missing.png" alt="Missing">';
    const cleanup = hydrateDocumentImages(
      root,
      "/docs/guide.md",
      async () => undefined,
    );
    const image = root.querySelector<HTMLImageElement>("img")!;
    const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
    await vi.waitFor(() =>
      expect(frame.classList.contains("is-error")).toBe(true),
    );
    expect(frame.dataset.imagePath).toBe("/docs/missing.png");
    expect(image.getAttribute("aria-busy")).toBeNull();

    frame.classList.add("is-loading");
    image.dispatchEvent(new Event("error"));
    expect(frame.classList.contains("is-loading")).toBe(false);
    expect(trackUserFacingErrorMock).toHaveBeenCalledTimes(1);
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: "Repository image failed to load",
      }),
      source: "DocumentImage.hydrate",
      operation: "repository-image-load",
      impact: "degraded",
    });

    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    root.innerHTML = '<img src="./late.png" alt="Late">';
    const lateImage = root.querySelector<HTMLImageElement>("img")!;
    const lateCleanup = hydrateDocumentImages(
      root,
      "/docs/guide.md",
      () => pending,
    );
    cleanup();
    frame.className = "emr-repo-image-frame is-loading";
    image.className = "emr-repo-image is-loading";
    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    expect(frame.className).toBe("emr-repo-image-frame is-loading");
    expect(image.className).toBe("emr-repo-image is-loading");
    lateCleanup();
    resolve("blob:late");
    await pending;
    await Promise.resolve();
    expect(lateImage.hasAttribute("src")).toBe(false);
  });

  it("shows an unavailable state when the repository resolver rejects", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<img src="./broken.png" alt="Broken">';
    hydrateDocumentImages(root, "/docs/guide.md", async () => {
      throw new Error("repository unavailable");
    });

    const frame = root.querySelector<HTMLElement>(".emr-repo-image-frame")!;
    await vi.waitFor(() =>
      expect(frame.classList.contains("is-error")).toBe(true),
    );
    expect(trackUserFacingErrorMock).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: "repository unavailable" }),
      source: "DocumentImage.hydrate",
      operation: "repository-image-load",
      impact: "degraded",
    });
  });
});
