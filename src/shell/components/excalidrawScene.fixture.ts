// A small Excalidraw scene for stories: two labelled boxes joined by an arrow.

const BASE = {
  angle: 0,
  strokeColor: "#1e1e1e",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  updated: 1,
  link: null,
  locked: false,
};

function box(id: string, x: number, label: string, fill: string) {
  return [
    {
      ...BASE,
      id,
      type: "rectangle",
      x,
      y: 0,
      width: 180,
      height: 80,
      backgroundColor: fill,
      roundness: { type: 3 },
      seed: x + 1,
      boundElements: [{ id: `${id}-label`, type: "text" }],
    },
    {
      ...BASE,
      id: `${id}-label`,
      type: "text",
      x: x + 20,
      y: 27,
      width: 140,
      height: 25,
      backgroundColor: "transparent",
      roundness: null,
      seed: x + 2,
      boundElements: null,
      text: label,
      originalText: label,
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: id,
      autoResize: true,
      lineHeight: 1.25,
    },
  ];
}

const EXCALIDRAW_SCENE = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    ...box("doc", 0, "Markdown", "#a5d8ff"),
    ...box("review", 300, "Review", "#b2f2bb"),
    {
      ...BASE,
      id: "flow",
      type: "arrow",
      x: 190,
      y: 40,
      width: 100,
      height: 0,
      backgroundColor: "transparent",
      roundness: { type: 2 },
      seed: 7,
      boundElements: null,
      points: [
        [0, 0],
        [100, 0],
      ],
      startBinding: { elementId: "doc", focus: 0, gap: 10 },
      endBinding: { elementId: "review", focus: 0, gap: 10 },
      startArrowhead: null,
      endArrowhead: "arrow",
      lastCommittedPoint: null,
      elbowed: false,
    },
    { ...BASE, id: "erased", type: "rectangle", isDeleted: true },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
};

export function excalidrawSceneBytes(scene: unknown = EXCALIDRAW_SCENE) {
  return new TextEncoder().encode(JSON.stringify(scene)).buffer;
}
