// React-hook tests for useDocumentSource, mounted in a jsdom root so the real
// load effect drives the per-file cache and the load/error state.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentSource } from "../src/shell/prShell/useDocumentSource";
import {
  deferred,
  HELD_SOURCE,
  heldRender,
  type Deferred,
} from "./prShellHarness";

vi.mock("../src/markdown/render", async (importOriginal) =>
  (await import("./prShellHarness")).withHeldRender(
    await importOriginal<typeof import("../src/markdown/render")>(),
  ),
);

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

  it("loads nothing until a file is selected", async () => {
    const loadFileSource = vi.fn(() => Promise.resolve("# A"));
    await show("", loadFileSource);
    expect(loadFileSource).not.toHaveBeenCalled();
    expect(doc.loading).toBe(false);
  });

  /**
   * Opens `docs/slow.md` (held on `slow`), moves to `docs/a.md`, lets
   * `settleSlow` finish the abandoned load, then re-renders `docs/a.md`.
   */
  async function abandonSlowLoad(
    settleSlow: (slow: Deferred<string>) => void,
  ): Promise<void> {
    const slow = deferred<string>();
    const loadFileSource = (path: string): Promise<string> =>
      path === "docs/slow.md" ? slow.promise : Promise.resolve("# A");
    await show("docs/slow.md", loadFileSource);
    await show("docs/a.md", loadFileSource);
    settleSlow(slow);
    await show("docs/a.md", loadFileSource);
  }

  it("drops a load that resolves after the selection moved on", async () => {
    await abandonSlowLoad((slow) => slow.resolve("# Slow"));
    expect(doc.htmlByPath["docs/slow.md"]).toBeUndefined();
    expect(doc.sourceByPath["docs/slow.md"]).toBeUndefined();
  });

  it("drops a render that finishes after the selection moved on", async () => {
    heldRender.gate = deferred<void>();
    const loadFileSource = (path: string): Promise<string> =>
      Promise.resolve(path === "docs/held.md" ? HELD_SOURCE : "# A");
    try {
      await show("docs/held.md", loadFileSource);
      await show("docs/a.md", loadFileSource);
      heldRender.gate.resolve();
      await show("docs/a.md", loadFileSource);
      expect(doc.htmlByPath["docs/held.md"]).toBeUndefined();
      expect(doc.htmlByPath["docs/a.md"]).toContain("A");
    } finally {
      heldRender.gate = null;
    }
  });

  it("ignores a failure that surfaces after the selection moved on", async () => {
    await abandonSlowLoad((slow) => slow.reject(new Error("late failure")));
    expect(doc.error).toBeNull();
  });
});
