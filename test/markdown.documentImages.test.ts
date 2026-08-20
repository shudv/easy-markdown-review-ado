import { describe, expect, it, vi } from "vitest";

import {
  hydrateDocumentImages,
  repositoryImageMimeType,
  resolveRepositoryImagePath,
} from "../src/markdown/documentImages";

describe("repositoryImageMimeType", () => {
  it("recognizes browser image formats and falls back safely", () => {
    expect(repositoryImageMimeType("/assets/diagram.SVG")).toBe(
      "image/svg+xml",
    );
    expect(repositoryImageMimeType("/assets/photo.jpeg")).toBe("image/jpeg");
    expect(repositoryImageMimeType("/assets/tour.gif")).toBe("image/gif");
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

    frame.classList.add("is-loading");
    image.dispatchEvent(new Event("error"));
    expect(frame.classList.contains("is-loading")).toBe(false);

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
    lateCleanup();
    resolve("blob:late");
    await pending;
    await Promise.resolve();
    expect(lateImage.hasAttribute("src")).toBe(false);
  });
});
