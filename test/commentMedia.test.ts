import { describe, expect, it, vi } from "vitest";

import {
  decorateCommentMedia,
  isAdoPullRequestAttachmentUrl,
} from "../src/comments/commentMedia";

describe("isAdoPullRequestAttachmentUrl", () => {
  it("recognizes absolute and relative PR attachment URLs", () => {
    expect(
      isAdoPullRequestAttachmentUrl(
        "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.pdf?download=true",
      ),
    ).toBe(true);
    expect(
      isAdoPullRequestAttachmentUrl(
        "/project/_apis/git/repositories/repo/pullRequests/47/attachments/demo.gif",
      ),
    ).toBe(true);
    expect(
      isAdoPullRequestAttachmentUrl(
        "https://contoso.visualstudio.com/project/_apis/git/repositories/repo/pullRequests/47/attachments/demo.gif",
      ),
    ).toBe(true);
  });

  it("rejects non-ADO hosts, non-HTTPS URLs, ordinary links, and malformed URLs", () => {
    expect(
      isAdoPullRequestAttachmentUrl(
        "https://example.test/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.pdf",
      ),
    ).toBe(false);
    expect(
      isAdoPullRequestAttachmentUrl(
        "http://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.pdf",
      ),
    ).toBe(false);
    expect(
      isAdoPullRequestAttachmentUrl("https://example.com/design.pdf"),
    ).toBe(false);
    expect(isAdoPullRequestAttachmentUrl("https://[invalid")).toBe(false);
  });
});

describe("decorateCommentMedia", () => {
  it("contains images in a noninteractive media frame", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p><img src="https://example.com/large.png" alt="Design"></p>';

    const cleanup = decorateCommentMedia(root);
    const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;

    expect(frame.hasAttribute("role")).toBe(false);
    expect(frame.hasAttribute("tabindex")).toBe(false);
    expect(frame.hasAttribute("aria-label")).toBe(false);

    cleanup();
  });

  it("reuses an existing media frame", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span class="emr-comment-media"><img src="https://example.com/framed.png" alt="Framed"></span>';
    const existing = root.firstElementChild;

    decorateCommentMedia(root);

    expect(root.firstElementChild).toBe(existing);
    expect(root.querySelectorAll(".emr-comment-media")).toHaveLength(1);
  });

  it("keeps a linked image's anchor as the only interactive surface", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<a href="https://example.com/full.png"><img src="https://example.com/preview.png" alt="Preview"></a>';
    decorateCommentMedia(root);

    const link = root.querySelector<HTMLAnchorElement>("a")!;
    expect(link.classList.contains("emr-comment-media")).toBe(false);
    expect(link.getAttribute("role")).toBeNull();
    expect(link.tabIndex).toBe(0);
    expect(link.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(link.querySelectorAll(".emr-comment-media")).toHaveLength(1);
  });

  it("labels images without alt text and settles completed direct images", () => {
    const root = document.createElement("div");
    root.innerHTML = '<img src="https://example.com/loaded.png" alt="">';
    const image = root.querySelector<HTMLImageElement>("img")!;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 320 },
    });

    decorateCommentMedia(root);

    const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
    expect(frame.classList.contains("is-error")).toBe(false);
  });

  it("marks a completed direct image failure unavailable", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<img src="https://example.com/missing.png" alt="Missing">';
    const image = root.querySelector<HTMLImageElement>("img")!;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
    });

    decorateCommentMedia(root);

    expect(
      root.querySelector(".emr-comment-media")?.classList.contains("is-error"),
    ).toBe(true);
  });

  it("decorates non-image ADO attachments without changing ordinary links", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<a href="https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/notes.pdf">notes.pdf</a>',
      '<a href="https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/unnamed.pdf"></a>',
      '<a href="https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/preview.png"><img src="https://example.com/preview.png" alt="Preview"></a>',
      '<a href="https://example.com/guide">Guide</a>',
    ].join("");

    decorateCommentMedia(root);

    const links = root.querySelectorAll<HTMLAnchorElement>("a");
    expect(links[0]!.classList.contains("emr-comment-attachment")).toBe(true);
    expect(links[0]!.target).toBe("_blank");
    expect(links[0]!.rel).toBe("noopener noreferrer");
    expect(links[1]!.getAttribute("aria-label")).toBe(
      "Attachment (attachment, opens in new tab)",
    );
    expect(links[2]!.classList.contains("emr-comment-attachment")).toBe(false);
    expect(links[3]!.classList.contains("emr-comment-attachment")).toBe(false);
  });

  it("replaces ADO image URLs with authenticated object URLs", async () => {
    const root = document.createElement("div");
    const original =
      "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.png";
    root.innerHTML = `<img src="${original}" alt="Design">`;
    const resolveImage = vi.fn().mockResolvedValue("blob:authenticated-image");

    decorateCommentMedia(root, resolveImage);
    const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
    const image = frame.querySelector<HTMLImageElement>("img")!;

    expect(frame.classList.contains("is-loading")).toBe(true);
    expect(frame.getAttribute("aria-disabled")).toBe("true");
    image.dispatchEvent(new Event("error"));
    expect(frame.classList.contains("is-error")).toBe(false);
    await vi.waitFor(() => expect(image.src).toBe("blob:authenticated-image"));

    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 640,
    });
    image.dispatchEvent(new Event("load"));
    expect(frame.classList.contains("is-loading")).toBe(false);
  });

  it("uses a completed direct image when authenticated loading is unavailable", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<img src="https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/direct.png" alt="Direct">';
    const image = root.querySelector<HTMLImageElement>("img")!;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 480 },
    });

    decorateCommentMedia(root, async () => undefined);
    const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;

    await vi.waitFor(() =>
      expect(frame.classList.contains("is-loading")).toBe(false),
    );
    expect(frame.classList.contains("is-error")).toBe(false);
  });

  it("shows an unavailable state when authenticated and direct loading fail", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<img src="https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/missing.png" alt="Missing">';

    const resolveImage = vi.fn(async () => undefined);
    decorateCommentMedia(root, resolveImage);
    const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
    const image = frame.querySelector<HTMLImageElement>("img")!;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
    });

    await vi.waitFor(() => expect(resolveImage).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(frame.classList.contains("is-error")).toBe(true),
    );
    expect(frame.classList.contains("is-loading")).toBe(false);
    expect(frame.getAttribute("aria-disabled")).toBeNull();
  });

  it("does not apply a resolved object URL after cleanup", async () => {
    let resolve!: (url: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const root = document.createElement("div");
    const original =
      "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.png";
    root.innerHTML = `<img src="${original}" alt="Design">`;

    const cleanup = decorateCommentMedia(root, () => pending);
    const image = root.querySelector<HTMLImageElement>("img")!;
    cleanup();
    resolve("blob:too-late");
    await pending;
    await Promise.resolve();

    expect(image.src).toBe(original);
  });
});
