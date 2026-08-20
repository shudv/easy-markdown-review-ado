// React-hook tests for useDraftPersistence, mounted in a jsdom root so the real
// effect lifecycle (restore on mount, flush on unmount) drives the behaviour.
// We assert observable outcomes only: localStorage contents, the restore
// callback, and the returned handlers/snapshot.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { TextQuoteAnchor } from "../src/types";
import {
  draftStorageKey,
  loadDraft,
  NEW_DRAFT_THREAD_ID,
  saveDraft,
  type DraftScope,
  type DraftTarget,
  type PersistedDraft,
} from "../src/shell/draftStorage";
import {
  useDraftPersistence,
  type DraftPersistence,
} from "../src/shell/useDraftPersistence";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const anchor: TextQuoteAnchor = {
  exact: "hello world",
  prefix: "",
  suffix: "",
};

const NEW_TARGET: DraftTarget = {
  path: "docs/a.md",
  threadId: NEW_DRAFT_THREAD_ID,
  anchor,
};
const REPLY_TARGET: DraftTarget = {
  path: "docs/a.md",
  threadId: "t-7",
  anchor: null,
};

function storedNew(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    path: "docs/a.md",
    threadId: NEW_DRAFT_THREAD_ID,
    anchor,
    body: "saved text",
    ...overrides,
  };
}

interface Handle {
  api: DraftPersistence;
  setTarget: (t: DraftTarget | null) => void;
  restored: Array<{ target: DraftTarget; body: string }>;
}

let handle: Handle;

function Harness(props: {
  scope?: DraftScope;
  initialTarget?: DraftTarget | null;
}): React.ReactElement {
  const [activeDraft, setTarget] = React.useState<DraftTarget | null>(
    props.initialTarget ?? null,
  );
  const restoredRef = React.useRef<
    Array<{ target: DraftTarget; body: string }>
  >([]);
  const api = useDraftPersistence({
    scope: props.scope,
    activeDraft,
    onRestore: (target, body) => {
      restoredRef.current.push({ target, body });
      setTarget(target);
    },
  });
  handle = { api, setTarget, restored: restoredRef.current };
  return React.createElement("div", null, api.initialBody);
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: {
  scope?: DraftScope;
  initialTarget?: DraftTarget | null;
}): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(Harness, props));
  });
}

function unmount(): void {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
}

afterEach(() => {
  unmount();
  window.localStorage.clear();
});

describe("persistence disabled (no scope)", () => {
  it("never touches storage", () => {
    mount({ initialTarget: NEW_TARGET });
    act(() => handle.api.handleChange("typed"));
    expect(window.localStorage.length).toBe(0);
    expect(handle.api.getSnapshot()).toBe("typed");
  });
});

describe("handleChange", () => {
  it("persists a new-comment draft with its anchor", () => {
    mount({ scope: "pr", initialTarget: NEW_TARGET });
    act(() => handle.api.handleChange("typed"));
    expect(loadDraft("pr")).toEqual({
      path: "docs/a.md",
      threadId: NEW_DRAFT_THREAD_ID,
      anchor,
      body: "typed",
    });
  });

  it("persists a reply draft with a null anchor", () => {
    mount({ scope: "pr", initialTarget: REPLY_TARGET });
    act(() => handle.api.handleChange("a reply"));
    expect(loadDraft("pr")).toEqual({
      path: "docs/a.md",
      threadId: "t-7",
      anchor: null,
      body: "a reply",
    });
  });

  it("does not persist without an active target", () => {
    mount({ scope: "pr", initialTarget: null });
    act(() => handle.api.handleChange("typed"));
    expect(loadDraft("pr")).toBeNull();
    // Snapshot still tracks the latest text for the lock check.
    expect(handle.api.getSnapshot()).toBe("typed");
  });

  it("clears persistence when the composer is emptied", () => {
    mount({ scope: "pr", initialTarget: NEW_TARGET });
    act(() => handle.api.handleChange("typed"));
    expect(loadDraft("pr")).not.toBeNull();
    act(() => handle.api.handleChange("   "));
    expect(loadDraft("pr")).toBeNull();
    expect(handle.api.getSnapshot()).toBe("   ");
  });
});

describe("restore on mount", () => {
  it("re-opens a stored new-comment draft", () => {
    saveDraft("pr", storedNew({ body: "welcome back" }));
    mount({ scope: "pr" });
    expect(handle.restored).toEqual([
      { target: NEW_TARGET, body: "welcome back" },
    ]);
    expect(handle.api.initialBody).toBe("welcome back");
    expect(handle.api.getSnapshot()).toBe("welcome back");
  });

  it("re-opens a stored reply draft", () => {
    saveDraft("pr", {
      path: "docs/a.md",
      threadId: "t-7",
      anchor: null,
      body: "restored reply",
    });
    mount({ scope: "pr" });
    expect(handle.restored).toEqual([
      { target: REPLY_TARGET, body: "restored reply" },
    ]);
  });

  it("does nothing when there is no stored draft", () => {
    mount({ scope: "pr" });
    expect(handle.restored).toEqual([]);
    expect(handle.api.initialBody).toBe("");
  });
});

describe("clear", () => {
  it("wipes storage and resets the seed + snapshot", () => {
    saveDraft("pr", storedNew({ body: "seed" }));
    mount({ scope: "pr" });
    expect(handle.api.initialBody).toBe("seed");
    act(() => handle.api.clear());
    expect(loadDraft("pr")).toBeNull();
    expect(handle.api.initialBody).toBe("");
    expect(handle.api.getSnapshot()).toBe("");
  });

  it("is safe with no scope", () => {
    mount({ initialTarget: NEW_TARGET });
    expect(() => act(() => handle.api.clear())).not.toThrow();
  });
});

describe("flush on unmount", () => {
  it("persists the latest queued (throttled) text", () => {
    mount({ scope: "pr", initialTarget: NEW_TARGET });
    act(() => handle.api.handleChange("a"));
    act(() => handle.api.handleChange("ab"));
    expect(loadDraft("pr")?.body).toBe("a");
    unmount();
    expect(
      JSON.parse(window.localStorage.getItem(draftStorageKey("pr"))!).body,
    ).toBe("ab");
  });
});
