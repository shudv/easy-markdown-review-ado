// React-hook tests for useDocumentSource, mounted in a jsdom root so the real
// load effect drives the per-file cache and the load/error state.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDocumentSource } from "../src/shell/prShell/useDocumentSource";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type DocumentSource = ReturnType<typeof useDocumentSource>;

let doc: DocumentSource;
let container: HTMLDivElement;
let root: Root;

function Harness(props: {
  selectedPath: string;
  loadFileSource: (path: string) => Promise<string>;
}): null {
  doc = useDocumentSource(props.selectedPath, props.loadFileSource);
  doc.handleMissingDocRef.current = () => "unexpected";
  return null;
}

async function show(
  selectedPath: string,
  loadFileSource: (path: string) => Promise<string>,
): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Harness, { selectedPath, loadFileSource }));
  });
  // Let the load and the Markdown render settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useDocumentSource", () => {
  it("clears a failed load's error when switching back to a cached document", async () => {
    const loadFileSource = (path: string): Promise<string> =>
      path === "docs/a.md"
        ? Promise.resolve("# A")
        : Promise.reject(new Error("load failed"));

    await show("docs/a.md", loadFileSource);
    expect(doc.htmlByPath["docs/a.md"]).toContain("A");
    expect(doc.error).toBeNull();

    await show("docs/b.md", loadFileSource);
    expect(doc.error).toContain("load failed");

    await show("docs/a.md", loadFileSource);
    expect(doc.error).toBeNull();
    expect(doc.loading).toBe(false);
  });

  it("stops the spinner when switching from an in-flight load to a cached document", async () => {
    const loadFileSource = (path: string): Promise<string> =>
      path === "docs/a.md"
        ? Promise.resolve("# A")
        : new Promise<string>(() => {});

    await show("docs/a.md", loadFileSource);
    await show("docs/slow.md", loadFileSource);
    expect(doc.loading).toBe(true);

    await show("docs/a.md", loadFileSource);
    expect(doc.loading).toBe(false);
  });
});
