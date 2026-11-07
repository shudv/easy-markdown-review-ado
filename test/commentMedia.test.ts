import { describe, expect, it, vi } from "vitest";

import { decorateCommentMedia, isAdoPullRequestAttachmentUrl } from "../src/comments/commentMedia";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

const ATTACHMENTS =
    "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments";

function mountComment(html: string): HTMLDivElement {
    const root = document.createElement("div");
    root.innerHTML = html;

    return root;
}

/** Pretend the browser already finished loading `image` (or failed to). */
function markImageSettled(image: HTMLImageElement, naturalWidth: number): void {
    Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalWidth: { configurable: true, value: naturalWidth },
    });
}

describe("isAdoPullRequestAttachmentUrl", () => {
    it.each([
        ["an absolute dev.azure.com attachment link", `${ATTACHMENTS}/design.pdf?download=true`],
        [
            "a relative attachment path",
            "/project/_apis/git/repositories/repo/pullRequests/47/attachments/demo.gif",
        ],
        [
            "a legacy visualstudio.com attachment link",
            "https://contoso.visualstudio.com/project/_apis/git/repositories/repo/pullRequests/47/attachments/demo.gif",
        ],
    ])("recognizes %s", (_label, url) => {
        expect(isAdoPullRequestAttachmentUrl(url)).toBe(true);
    });

    it.each([
        [
            "an attachment path on a non-ADO host",
            "https://example.test/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.pdf",
        ],
        [
            "an attachment link over plain http",
            // eslint-disable-next-line sonarjs/no-clear-text-protocols -- negative case: asserts an http:// attachment URL is rejected
            "http://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/47/attachments/design.pdf",
        ],
        ["an ordinary file link", "https://example.com/design.pdf"],
        ["a malformed URL", "https://[invalid"],
    ])("rejects %s", (_label, url) => {
        expect(isAdoPullRequestAttachmentUrl(url)).toBe(false);
    });
});

describe("decorateCommentMedia", () => {
    it("frames an image without turning the frame into an interactive control", () => {
        const root = mountComment('<p><img src="https://example.com/large.png" alt="Design"></p>');

        decorateCommentMedia(root);
        const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;

        expect(frame.hasAttribute("role")).toBe(false);
        expect(frame.hasAttribute("tabindex")).toBe(false);
        expect(frame.hasAttribute("aria-label")).toBe(false);
    });

    it("does not wrap an already-framed image in a second frame", () => {
        const root = mountComment(
            '<span class="emr-comment-media"><img src="https://example.com/framed.png" alt="Framed"></span>',
        );

        const existing = root.firstElementChild;

        decorateCommentMedia(root);

        expect(root.firstElementChild).toBe(existing);
        expect(root.querySelectorAll(".emr-comment-media")).toHaveLength(1);
    });

    it("keeps a linked image's link as the only interactive surface", () => {
        const root = mountComment(
            '<a href="https://example.com/full.png"><img src="https://example.com/preview.png" alt="Preview"></a>',
        );

        decorateCommentMedia(root);

        const link = root.querySelector<HTMLAnchorElement>("a")!;
        expect(link.classList.contains("emr-comment-media")).toBe(false);
        expect(link.getAttribute("role")).toBeNull();
        expect(link.tabIndex).toBe(0);
        expect(link.querySelectorAll('[role="button"]')).toHaveLength(0);
        expect(link.querySelectorAll(".emr-comment-media")).toHaveLength(1);
    });

    it("shows an already-loaded external image without an error state", () => {
        const root = mountComment('<img src="https://example.com/loaded.png" alt="">');
        markImageSettled(root.querySelector("img")!, 320);

        decorateCommentMedia(root);

        expect(root.querySelector(".emr-comment-media")?.classList.contains("is-error")).toBe(
            false,
        );
    });

    it("marks a broken external image unavailable without reporting it as an app failure", () => {
        const root = mountComment('<img src="https://example.com/missing.png" alt="Missing">');
        markImageSettled(root.querySelector("img")!, 0);

        decorateCommentMedia(root);

        expect(root.querySelector(".emr-comment-media")?.classList.contains("is-error")).toBe(true);
        expect(telemetry.current.userFacingErrors()).toEqual([]);
    });

    it("opens a PR attachment link in a new tab and labels it as an attachment", () => {
        const root = mountComment(`<a href="${ATTACHMENTS}/notes.pdf">notes.pdf</a>`);

        decorateCommentMedia(root);

        const link = root.querySelector("a")!;
        expect(link.classList.contains("emr-comment-attachment")).toBe(true);
        expect(link.target).toBe("_blank");
        expect(link.rel).toBe("noopener noreferrer");
        expect(link.getAttribute("aria-label")).toBe("notes.pdf (attachment, opens in new tab)");
    });

    it("labels an attachment link that has no text as 'Attachment'", () => {
        const root = mountComment(`<a href="${ATTACHMENTS}/unnamed.pdf"></a>`);

        decorateCommentMedia(root);

        expect(root.querySelector("a")!.getAttribute("aria-label")).toBe(
            "Attachment (attachment, opens in new tab)",
        );
    });

    it.each([
        [
            "an attachment link wrapping an image",
            `<a href="${ATTACHMENTS}/preview.png"><img src="https://example.com/preview.png" alt="Preview"></a>`,
        ],
        ["an external link", '<a href="https://example.com/guide">Guide</a>'],
    ])("leaves %s as an ordinary link", (_label, html) => {
        const root = mountComment(html);

        decorateCommentMedia(root);

        expect(root.querySelector("a")!.classList.contains("emr-comment-attachment")).toBe(false);
    });

    it("replaces ADO image URLs with authenticated object URLs", async () => {
        const root = mountComment(`<img src="${ATTACHMENTS}/design.png" alt="Design">`);
        const resolveImage = vi.fn().mockResolvedValue("blob:authenticated-image");

        decorateCommentMedia(root, resolveImage);
        const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
        const image = frame.querySelector<HTMLImageElement>("img")!;

        expect(frame.classList.contains("is-loading")).toBe(true);
        expect(frame.getAttribute("aria-disabled")).toBe("true");
        // The unauthenticated original fails while the object URL is still on its way.
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
        const root = mountComment(`<img src="${ATTACHMENTS}/direct.png" alt="Direct">`);
        markImageSettled(root.querySelector("img")!, 480);

        decorateCommentMedia(root, async () => undefined);
        const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;

        await vi.waitFor(() => expect(frame.classList.contains("is-loading")).toBe(false));
        expect(frame.classList.contains("is-error")).toBe(false);
    });

    it("shows an unavailable state and reports it once when authenticated and direct loading fail", async () => {
        const root = mountComment(`<img src="${ATTACHMENTS}/missing.png" alt="Missing">`);
        const resolveImage = vi.fn(async () => undefined);

        decorateCommentMedia(root, resolveImage);
        const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
        const image = frame.querySelector<HTMLImageElement>("img")!;
        markImageSettled(image, 0);

        await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));
        // A later error event for the same image must not report again.
        image.dispatchEvent(new Event("error"));

        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "Comment image failed to load" }),
                source: "CommentMedia.decorate",
                operation: "comment-image-load",
                impact: "degraded",
            }),
        ]);
        expect(frame.classList.contains("is-loading")).toBe(false);
        expect(frame.getAttribute("aria-disabled")).toBeNull();
    });

    it("falls back to an unavailable state when the attachment resolver rejects", async () => {
        const root = mountComment(`<img src="${ATTACHMENTS}/rejected.png" alt="Rejected">`);
        markImageSettled(root.querySelector("img")!, 0);

        decorateCommentMedia(root, async () => {
            throw new Error("attachment unavailable");
        });

        const frame = root.querySelector<HTMLElement>(".emr-comment-media")!;
        await vi.waitFor(() => expect(frame.classList.contains("is-error")).toBe(true));
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({ message: "attachment unavailable" }),
                source: "CommentMedia.decorate",
                operation: "comment-image-load",
                impact: "degraded",
            }),
        ]);
    });

    it("does not apply a resolved object URL after cleanup", async () => {
        let resolve!: (url: string) => void;

        const pending = new Promise<string>((done) => {
            resolve = done;
        });

        const original = `${ATTACHMENTS}/design.png`;
        const root = mountComment(`<img src="${original}" alt="Design">`);

        const cleanup = decorateCommentMedia(root, () => pending);
        const image = root.querySelector<HTMLImageElement>("img")!;
        cleanup();
        resolve("blob:too-late");
        await pending;
        await Promise.resolve();

        expect(image.src).toBe(original);
    });
});
