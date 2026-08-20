// React-hook tests for the two context-backed comment hooks. Mounted in a
// jsdom root so the real React render/effect lifecycle drives them — we only
// assert observable behaviour (return value / thrown error / hydrated DOM),
// never internal state.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CommentApiProvider, useCommentApi } from "../src/comments/api";
import type { CommentApi } from "../src/comments/api";
import {
  MentionLinkContext,
  useMentionLinkHydration,
  type MentionLinkResolution,
} from "../src/comments/mentionLinks";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: React.ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

// Minimal error boundary so a hook that throws during render is captured as a
// value instead of crashing the test runner.
class Boundary extends React.Component<
  { onError: (e: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }
  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

describe("useCommentApi", () => {
  it("returns the provider's value to descendants", () => {
    const api = { marker: "the-api" } as unknown as CommentApi;
    let seen: CommentApi | null = null;
    function Consumer(): null {
      seen = useCommentApi();
      return null;
    }
    mount(
      React.createElement(
        CommentApiProvider,
        { value: api },
        React.createElement(Consumer),
      ),
    );
    expect(seen).toBe(api);
  });

  it("throws when used without a provider", () => {
    let captured: Error | null = null;
    function Consumer(): null {
      useCommentApi();
      return null;
    }
    mount(
      React.createElement(
        Boundary,
        { onError: (e: Error) => (captured = e) },
        React.createElement(Consumer),
      ),
    );
    expect(captured).not.toBeNull();
    expect(captured!.message).toMatch(/useCommentApi must be used inside/);
  });
});

describe("useMentionLinkHydration", () => {
  const CTX: MentionLinkResolution = {
    orgUrl: "https://dev.azure.com/contoso",
    projectName: "Proj",
    defaultRepoName: "repo",
  };

  // The hook reads MentionLinkContext from ABOVE it, so the provider must be
  // an ancestor of the component that calls the hook.
  function Inner(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    useMentionLinkHydration(ref, []);
    return React.createElement("div", {
      ref,
      dangerouslySetInnerHTML: {
        __html:
          '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="7" href="mention://workitem/7">#7</a>',
      },
    });
  }

  function Host(props: {
    ctx: MentionLinkResolution | null;
  }): React.ReactElement {
    return React.createElement(
      MentionLinkContext.Provider,
      { value: props.ctx },
      React.createElement(Inner),
    );
  }

  it("rewrites placeholder mention hrefs after mount using context", () => {
    mount(React.createElement(Host, { ctx: CTX }));
    const a = container!.querySelector("a")!;
    expect(a.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Proj/_workitems/edit/7",
    );
  });

  it("leaves placeholders untouched when context is absent", () => {
    mount(React.createElement(Host, { ctx: null }));
    const a = container!.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("mention://workitem/7");
  });
});
