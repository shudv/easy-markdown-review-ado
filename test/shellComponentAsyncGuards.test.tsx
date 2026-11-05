// Async and context edge cases of small shell components, rendered in jsdom:
// a stale avatar photo, a comment link copy with no shareable URL, and font
// detection that settles after the status bar unmounts.
//
// @vitest-environment jsdom

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar, AvatarImageContext } from "../src/shell/components/Avatar";
import { useCommentLinkCopy } from "../src/shell/components/CommentRow.hooks";
import { ReaderStatusBar } from "../src/shell/components/ReaderStatusBar";
import type { CommentAuthor } from "../src/types";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement): void {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  React.act(() => root!.render(element));
}

function unmount(): void {
  if (root) React.act(() => root!.unmount());
  root = null;
}

afterEach(() => {
  unmount();
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function author(id: string): CommentAuthor {
  return {
    id,
    displayName: id,
    initials: id.slice(0, 2).toUpperCase(),
    avatarUrl: `https://dev.azure.com/_apis/avatar/${id}`,
  };
}

describe("Avatar", () => {
  it("ignores a photo that resolves after the author changed", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const resolver = vi.fn((url: string) => {
      const d = deferred<string>();
      pending.set(url, d);
      return d.promise;
    });
    const withResolver = (who: CommentAuthor) => (
      <AvatarImageContext.Provider value={resolver}>
        <Avatar author={who} />
      </AvatarImageContext.Provider>
    );
    render(withResolver(author("first")));
    render(withResolver(author("second")));

    await React.act(async () => {
      pending.get(author("first").avatarUrl!)!.resolve("blob:first");
    });
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.textContent).toBe("SE");

    await React.act(async () => {
      pending.get(author("second").avatarUrl!)!.resolve("blob:second");
    });
    expect(container!.querySelector("img")!.getAttribute("src")).toBe(
      "blob:second",
    );
  });

  it("swaps straight to the new author's photo without a resolver", () => {
    render(<Avatar author={author("first")} />);
    render(<Avatar author={author("second")} />);
    expect(container!.querySelector("img")!.getAttribute("src")).toBe(
      author("second").avatarUrl,
    );

    render(<Avatar author={{ ...author("third"), avatarUrl: undefined }} />);
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.textContent).toBe("TH");
  });
});

describe("useCommentLinkCopy", () => {
  it("does nothing when asked to copy on a surface with no shareable URL", () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let hook: ReturnType<typeof useCommentLinkCopy> | null = null;
    function Probe(): null {
      hook = useCommentLinkCopy("t1");
      return null;
    }
    render(<Probe />);
    expect(hook!.canLink).toBe(false);
    React.act(() => hook!.handleLink());
    expect(hook!.linkState).toBe("idle");
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("ReaderStatusBar", () => {
  it("drops a font probe that settles after the bar unmounted", async () => {
    const probe = deferred<void>();
    const load = vi.fn(() => probe.promise);
    vi.stubGlobal(
      "FontFace",
      class {
        status = "loaded";
        load = load;
      },
    );
    const error = vi.spyOn(console, "error");
    render(
      <ReaderStatusBar
        fontId="system"
        sizePct={100}
        spacingPct={100}
        onFontChange={() => {}}
        onSizeChange={() => {}}
        onSpacingChange={() => {}}
        showNav
        onToggleNav={() => {}}
        navToggleable
        showComments
        onToggleComments={() => {}}
        changesAvailable={false}
        changesShown={false}
        onToggleChanges={() => {}}
      />,
    );
    expect(load).toHaveBeenCalled();
    unmount();
    await React.act(async () => probe.resolve());
    expect(error).not.toHaveBeenCalled();
  });
});
