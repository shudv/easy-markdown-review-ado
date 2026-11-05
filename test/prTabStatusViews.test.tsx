// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BootErrorView,
  NoMarkdownFilesView,
  SessionRefreshingView,
} from "../src/pr-tab/PrTabStatusViews";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
});

function mount(element: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

function click(el: Element | null): void {
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SessionRefreshingView", () => {
  it("reassures without a manual action while an auto reload is pending", () => {
    const onReload = vi.fn();
    const el = mount(<SessionRefreshingView autoReload onReload={onReload} />);
    const status = el.querySelector(".emr-error[role='status']");
    expect(status?.querySelector("h2")?.textContent).toBe(
      "Reconnecting to Azure DevOps…",
    );
    expect(status?.textContent).toContain("This only takes a moment.");
    expect(el.querySelector("button")).toBeNull();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("offers a manual reload once auto recovery is off", () => {
    const onReload = vi.fn();
    const el = mount(
      <SessionRefreshingView autoReload={false} onReload={onReload} />,
    );
    expect(el.textContent).toContain(
      "This usually fixes itself within a few minutes.",
    );
    const button = el.querySelector("button.emr-error-retry");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.textContent).toBe("Reload page");
    click(button);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("BootErrorView", () => {
  it("shows the error and retries on demand", () => {
    const onRetry = vi.fn();
    const el = mount(
      <BootErrorView error="TF400813: nope" onRetry={onRetry} />,
    );
    expect(el.querySelector(".emr-error h2")?.textContent).toBe(
      "Something went wrong",
    );
    expect(el.querySelector("pre")?.textContent).toBe("TF400813: nope");
    const button = el.querySelector("button.emr-error-retry");
    expect(button?.textContent).toBe("Try again");
    click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("NoMarkdownFilesView", () => {
  it("explains that only Markdown files are shown", () => {
    const el = mount(<NoMarkdownFilesView />);
    expect(el.querySelector(".emr-error h2")?.textContent).toBe(
      "No Markdown files changed in this PR",
    );
    expect(el.querySelector("p")?.textContent).toContain(
      "Switch to the Files tab for the rest.",
    );
  });
});
