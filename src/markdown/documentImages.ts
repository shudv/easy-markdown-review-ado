import { trackUserFacingError } from "../telemetry";

export type RepositoryImageResolver = (
  repositoryPath: string,
) => Promise<string | undefined>;

export type DocumentImageResolver = (
  documentPath: string,
  repositoryPath: string,
  atCommitId?: string,
) => Promise<string | undefined>;

const REPOSITORY_BASE = "https://repository.invalid";

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function repositoryImageMimeType(path: string): string {
  const normalized = path.toLowerCase();
  const extension = Object.keys(IMAGE_MIME_TYPES).find((candidate) =>
    normalized.endsWith(candidate),
  );
  return extension ? IMAGE_MIME_TYPES[extension]! : "application/octet-stream";
}

export function resolveRepositoryImagePath(
  documentPath: string,
  imageSource: string,
): string | null {
  const source = imageSource.trim();
  if (!source || source.startsWith("#") || source.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return null;

  try {
    const normalizedDocument = documentPath.startsWith("/")
      ? documentPath
      : `/${documentPath}`;
    const documentUrl = new URL(normalizedDocument, REPOSITORY_BASE);
    const resolved = new URL(source, documentUrl);
    return decodeURIComponent(resolved.pathname);
  } catch {
    return null;
  }
}

export function hydrateDocumentImages(
  root: HTMLElement,
  documentPath: string,
  resolveImage: RepositoryImageResolver,
): () => void {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  for (const image of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    const repositoryPath = resolveRepositoryImagePath(
      documentPath,
      image.getAttribute("src")!,
    );
    if (!repositoryPath) continue;

    const frame = document.createElement("span");
    frame.className = "emr-repo-image-frame is-loading";
    image.replaceWith(frame);
    frame.append(image);
    image.removeAttribute("src");
    image.classList.add("emr-repo-image", "is-loading");
    image.setAttribute("aria-busy", "true");
    let errorReported = false;
    const onLoad = () => {
      frame.classList.remove("is-loading", "is-error");
      image.classList.remove("is-loading", "is-error");
      image.removeAttribute("aria-busy");
    };
    const showError = (error: unknown) => {
      frame.classList.remove("is-loading");
      frame.classList.add("is-error");
      frame.dataset.imagePath = repositoryPath;
      image.classList.remove("is-loading");
      image.classList.add("is-error");
      image.removeAttribute("aria-busy");
      if (!errorReported) {
        errorReported = true;
        trackUserFacingError({
          error,
          source: "DocumentImage.hydrate",
          operation: "repository-image-load",
          impact: "degraded",
        });
      }
    };
    const onError = () =>
      showError(new Error("Repository image failed to load"));
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    cleanups.push(() => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    });
    const settle = (objectUrl: string | undefined, error?: unknown) => {
      if (disposed) return;
      if (objectUrl) {
        image.src = objectUrl;
      } else {
        showError(error ?? new Error("Repository image failed to load"));
      }
    };
    void resolveImage(repositoryPath).then(
      (objectUrl) => settle(objectUrl),
      (error: unknown) => settle(undefined, error),
    );
  }

  return () => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
  };
}
