// @vitest-environment jsdom

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ReaderLoadingShell } from "../src/shell/components/ReaderLoadingShell";
import { layoutStorageKey, READER_TYPE_KEY } from "../src/shell/readerPrefs";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) React.act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
});

function mount(
  scope: "pr" | "hub",
  options: {
    hideDocNav?: boolean;
    titleSlot?: React.ReactNode;
    headerActions?: React.ReactNode;
  } = {},
): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  React.act(() => {
    root!.render(
      <ReaderLoadingShell
        scope={scope}
        ariaLabel="Loading reader"
        hideDocNav={options.hideDocNav}
        titleSlot={options.titleSlot}
        headerActions={options.headerActions}
      />,
    );
  });
  return container.querySelector<HTMLElement>(".emr-app")!;
}

describe("ReaderLoadingShell", () => {
  it("restores the surface layout and typography before data loads", () => {
    localStorage.setItem(
      READER_TYPE_KEY,
      JSON.stringify({ fontId: "georgia", sizePct: 115 }),
    );
    localStorage.setItem(
      layoutStorageKey("pr"),
      JSON.stringify({
        showNav: false,
        showComments: true,
        navWidthPct: 120,
        commentWidthPct: 85,
      }),
    );

    const shell = mount("pr");

    expect(shell.classList.contains("is-nav-hidden")).toBe(true);
    expect(shell.classList.contains("is-comments-hidden")).toBe(false);
    expect(shell.style.getPropertyValue("--emr-reader-font")).toContain(
      "Georgia",
    );
    expect(shell.style.getPropertyValue("--emr-reader-scale")).toBe("1.15");
    expect(shell.style.getPropertyValue("--emr-nav-scale")).toBe("1.2");
    expect(shell.style.getPropertyValue("--emr-rail-scale")).toBe("0.85");
  });

  it("uses the settled three-pane DOM and silent shimmer placeholders", () => {
    const shell = mount("hub");

    expect(
      shell.querySelector(".emr-body-frame > .emr-body__nav"),
    ).toBeTruthy();
    expect(shell.querySelector(".emr-body-frame > .emr-body")).toBeTruthy();
    expect(shell.querySelector(".emr-body-frame > .emr-rail")).toBeTruthy();
    expect(shell.querySelector(".emr-docnav-skel")).toBeTruthy();
    expect(shell.querySelector(".emr-article-wrap.emr-skeleton")).toBeTruthy();
    expect(shell.querySelector(".emr-rail-col.emr-skeleton")).toBeTruthy();
    expect(shell.textContent).toBe("");
  });

  it("matches the no-nav geometry used by direct document links", () => {
    const shell = mount("hub", { hideDocNav: true });

    expect(shell.classList.contains("is-nav-hidden")).toBe(true);
    expect(shell.querySelector(".emr-body__nav")).toBeNull();
    expect(
      shell.querySelector(".emr-body-frame--no-nav > .emr-body"),
    ).toBeTruthy();
    expect(shell.querySelector(".emr-rail")).toBeTruthy();
  });

  it("restores hidden comments and renders either header slot", () => {
    localStorage.setItem(
      layoutStorageKey("hub"),
      JSON.stringify({ showComments: false }),
    );

    let shell = mount("hub", { titleSlot: <span>Repository</span> });
    expect(shell.classList.contains("is-comments-hidden")).toBe(true);
    expect(shell.querySelector(".emr-docnav-header")?.textContent).toBe(
      "Repository",
    );

    React.act(() => root!.unmount());
    root = null;
    container!.remove();
    container = null;

    shell = mount("hub", { headerActions: <button>Refresh</button> });
    expect(shell.querySelector(".emr-docnav-header")?.textContent).toBe(
      "Refresh",
    );
  });
});
