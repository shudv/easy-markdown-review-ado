import { t } from "../i18n";
import { trackUserFacingError } from "../telemetry";

export type ResolveCommentImage = (url: string) => Promise<string | undefined>;

const ADO_PR_ATTACHMENT_PATH =
    /\/_apis\/git\/repositories\/[^/]+\/pullrequests\/\d+\/attachments\/[^/]+\/?$/i;

function isAzureDevOpsHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();

    return normalized === "dev.azure.com" || normalized.endsWith(".visualstudio.com");
}

export function isAdoPullRequestAttachmentUrl(raw: string): boolean {
    try {
        const url = new URL(raw, "https://dev.azure.com/");

        return (
            url.protocol === "https:" &&
            isAzureDevOpsHost(url.hostname) &&
            ADO_PR_ATTACHMENT_PATH.test(url.pathname)
        );
    } catch {
        return false;
    }
}

function ensureMediaFrame(image: HTMLImageElement): HTMLElement {
    let frame = image.parentElement;

    // Stryker disable next-line OptionalChaining: dead code: images are found by querying inside a comment root, so they always have a parent element, candidate for removal
    if (!frame?.classList.contains("emr-comment-media")) {
        frame = document.createElement("span");
        frame.className = "emr-comment-media";
        image.replaceWith(frame);
        frame.append(image);
    }

    return frame;
}

function decorateImage(
    image: HTMLImageElement,
    resolveImage: ResolveCommentImage | undefined,
    isDisposed: () => boolean,
): () => void {
    const originalSrc = image.src;
    image.classList.add("emr-comment-image");
    const frame = ensureMediaFrame(image);
    // Shown by the frame's ::after while loading / after a failure (styles.scss).
    frame.dataset.loadingLabel = t("common.loadingImage");
    frame.dataset.errorLabel = t("common.imageUnavailable");

    const isNativeAttachment =
        resolveImage !== undefined && isAdoPullRequestAttachmentUrl(originalSrc);

    let resolving = isNativeAttachment;
    let errorReported = false;
    let resolutionError: unknown;

    const onLoad = () => {
        frame.classList.remove("is-loading", "is-error");
        image.classList.remove("is-loading");
        frame.removeAttribute("aria-disabled");
    };

    const onError = () => {
        if (resolving) return;
        frame.classList.remove("is-loading");
        frame.classList.add("is-error");
        image.classList.remove("is-loading");
        frame.removeAttribute("aria-disabled");

        if (isNativeAttachment && !errorReported) {
            errorReported = true;
            trackUserFacingError({
                error: resolutionError ?? new Error("Comment image failed to load"),
                source: "CommentMedia.decorate",
                operation: "comment-image-load",
                impact: "degraded",
            });
        }
    };

    const settleIfComplete = () => {
        if (!image.complete) return;
        if (image.naturalWidth > 0) onLoad();
        else onError();
    };

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);

    if (resolving && resolveImage) {
        frame.classList.add("is-loading");
        image.classList.add("is-loading");
        frame.setAttribute("aria-disabled", "true");

        const settle = (objectUrl: string | undefined, error?: unknown) => {
            if (isDisposed()) return;
            resolving = false;
            resolutionError = error;
            // Stryker disable next-line ConditionalExpression,StringLiteral: dead code: the authenticated loader returns a URL.createObjectURL result or undefined, never an empty string, candidate for removal
            if (objectUrl !== undefined && objectUrl !== "") {
                image.src = objectUrl;
            } else settleIfComplete();
        };

        void resolveImage(originalSrc).then(
            (objectUrl) => settle(objectUrl),
            (error: unknown) => settle(undefined, error),
        );
    } else settleIfComplete();

    return () => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
    };
}

function decorateAttachmentLinks(root: HTMLElement): void {
    for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (link.querySelector("img") || !isAdoPullRequestAttachmentUrl(link.href)) {
            continue;
        }

        link.classList.add("emr-comment-attachment");
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const label = link.textContent.trim() || t("comments.media.attachment");
        link.setAttribute("aria-label", t("comments.media.attachmentLabel", { label }));
        link.title = t("comments.media.openAttachment");
    }
}

export function decorateCommentMedia(
    root: HTMLElement,
    resolveImage?: ResolveCommentImage,
): () => void {
    const cleanups: Array<() => void> = [];
    let disposed = false;
    const isDisposed = () => disposed;

    for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
        cleanups.push(decorateImage(image, resolveImage, isDisposed));
    }

    decorateAttachmentLinks(root);

    return () => {
        disposed = true;
        for (const cleanup of cleanups) cleanup();
    };
}
