// Excalidraw drawings referenced as Markdown images.
//
// `![Architecture](./arch.excalidraw)` points at a raw Excalidraw scene (JSON),
// which a browser can't display. The repository image resolver passes the
// fetched bytes to `renderExcalidrawSvgBlob`, which lazy-loads Excalidraw and
// exports the scene to a standalone SVG. That SVG goes through the existing
// `<img>` frame, so any script in it never runs, and comments, diffs and the
// loading/error states treat the drawing like any other repository image.
//
// The drawing is rendered once in light mode. Dark themes apply Excalidraw's
// own dark-mode CSS filter (`.emr-excalidraw` in styles.scss), so a theme flip
// never needs a re-render.

import { withChunkRetry } from "./chunkRetry";

// Excalidraw 0.18's published typings point at unpublished workspace paths
// (`@excalidraw/utils/export`), so its own types resolve to `any`. Describe the
// slice of `exportToSvg` we call instead.
type ExcalidrawElement = Readonly<Record<string, unknown>>;
type BinaryFiles = Readonly<Record<string, unknown>>;
type ExportToSvg = (input: {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  exportPadding: number;
  appState: {
    exportBackground: boolean;
    exportEmbedScene: boolean;
    exportWithDarkMode: boolean;
    viewBackgroundColor: string;
  };
}) => Promise<SVGSVGElement>;
type ExcalidrawModule = { exportToSvg: ExportToSvg };

/** Class on an `<img>` showing a rendered Excalidraw drawing. */
export const EXCALIDRAW_CLASS = "emr-excalidraw";

/** Where the build copies Excalidraw's fonts, relative to the bundle root. */
const ASSET_DIRECTORY = "excalidraw-assets/";

const DEFAULT_BACKGROUND = "#ffffff";
const EXPORT_PADDING = 16;

export function isExcalidrawPath(path: string): boolean {
  return /\.excalidraw(?:\.json)?$/i.test(path);
}

/** The file isn't a usable Excalidraw scene: content health, not a fault. */
export class ExcalidrawSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcalidrawSceneError";
  }
}

type ExcalidrawScene = {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  viewBackgroundColor: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExcalidrawScene(text: string): ExcalidrawScene {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ExcalidrawSceneError("Excalidraw file is not valid JSON");
  }
  if (
    !isRecord(data) ||
    data.type !== "excalidraw" ||
    !Array.isArray(data.elements)
  ) {
    throw new ExcalidrawSceneError("File is not an Excalidraw scene");
  }
  const appState = isRecord(data.appState) ? data.appState : {};
  return {
    elements: data.elements.filter(
      (element): element is ExcalidrawElement =>
        isRecord(element) && element.isDeleted !== true,
    ),
    files: isRecord(data.files) ? data.files : null,
    // Only the canvas colour is honoured from the author's app state; the
    // export options are ours, so a saved `exportWithDarkMode` can't double
    // up with the reader's dark filter.
    viewBackgroundColor:
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : DEFAULT_BACKGROUND,
  };
}

// Excalidraw inlines its hand-drawn fonts into each exported SVG. Point it at
// the copies shipped inside the extension; otherwise it fetches them from a
// public CDN (esm.sh) on every render.
function pointAtBundledAssets(): void {
  if (typeof __webpack_public_path__ !== "string") return;
  (
    window as Window & { EXCALIDRAW_ASSET_PATH?: string }
  ).EXCALIDRAW_ASSET_PATH = `${__webpack_public_path__}${ASSET_DIRECTORY}`;
}

let exporterPromise: Promise<ExportToSvg> | null = null;

function loadExporter(): Promise<ExportToSvg> {
  if (exporterPromise) return exporterPromise;
  pointAtBundledAssets();
  exporterPromise = withChunkRetry(
    () =>
      import(
        /* webpackChunkName: "excalidraw" */ "@excalidraw/excalidraw"
      ) as Promise<unknown> as Promise<ExcalidrawModule>,
  ).then(
    (mod) => mod.exportToSvg,
    (error: unknown) => {
      // Let a later render retry instead of keeping the first load failure.
      exporterPromise = null;
      throw error;
    },
  );
  return exporterPromise;
}

/**
 * Render the bytes of an `.excalidraw` file to a light-mode SVG blob. Rejects
 * with `ExcalidrawSceneError` when the file isn't a scene; that check runs
 * before the library loads, so a bad file never pays for the download.
 */
export async function renderExcalidrawSvgBlob(
  content: ArrayBuffer,
): Promise<Blob> {
  const scene = parseExcalidrawScene(new TextDecoder().decode(content));
  const exportSvg = await loadExporter();
  const svg = await exportSvg({
    elements: scene.elements,
    files: scene.files,
    exportPadding: EXPORT_PADDING,
    appState: {
      exportBackground: true,
      exportEmbedScene: false,
      exportWithDarkMode: false,
      viewBackgroundColor: scene.viewBackgroundColor,
    },
  });
  return new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml",
  });
}
