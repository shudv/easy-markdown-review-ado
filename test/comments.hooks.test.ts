// React-hook tests for the context-backed comment hooks. Mounted in a
// jsdom root so the real React render/effect lifecycle drives them — we only
// assert observable behaviour (return value / thrown error / hydrated DOM),
// never internal state.
//
// @vitest-environment jsdom

import { act, Component, createElement, type ReactElement, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CommentApiProvider, useCommentApi } from "../src/comments/api";
import type { CommentApi } from "../src/comments/api";
import {
    IdentityStore,
    IdentityStoreContext,
    useUserMentionHydration,
} from "../src/comments/identityStore";
import {
    MentionLinkContext,
    useMentionLinkHydration,
    type MentionLinkResolution,
} from "../src/comments/mentionLinks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: ReactElement): void {
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
class Boundary extends Component<
    { onError: (e: Error) => void; children?: ReactNode },
    { failed: boolean }
> {
    override state = { failed: false };
    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }
    override componentDidCatch(error: Error): void {
        this.props.onError(error);
    }
    override render(): ReactNode {
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

        mount(createElement(CommentApiProvider, { value: api }, createElement(Consumer)));
        expect(seen).toBe(api);
    });

    it("throws when used without a provider", () => {
        let captured: Error | null = null;

        function Consumer(): null {
            useCommentApi();

            return null;
        }

        mount(
            createElement(
                Boundary,
                { onError: (e: Error) => (captured = e) },
                createElement(Consumer),
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
    function Inner(): ReactElement {
        const ref = useRef<HTMLDivElement>(null);
        useMentionLinkHydration(ref, []);

        return createElement("div", {
            ref,
            dangerouslySetInnerHTML: {
                __html: '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="7" href="mention://workitem/7">#7</a>',
            },
        });
    }

    function Host(props: { ctx: MentionLinkResolution | null }): ReactElement {
        return createElement(
            MentionLinkContext.Provider,
            { value: props.ctx },
            createElement(Inner),
        );
    }

    it("rewrites placeholder mention hrefs after mount using context", () => {
        mount(createElement(Host, { ctx: CTX }));
        const a = container!.querySelector("a")!;
        expect(a.getAttribute("href")).toBe("https://dev.azure.com/contoso/Proj/_workitems/edit/7");
    });

    it("leaves placeholders untouched when context is absent", () => {
        mount(createElement(Host, { ctx: null }));
        const a = container!.querySelector("a")!;
        expect(a.getAttribute("href")).toBe("mention://workitem/7");
    });

    it("upgrades placeholders once the org context becomes available", () => {
        mount(createElement(Host, { ctx: null }));

        act(() => root!.render(createElement(Host, { ctx: CTX })));

        expect(container!.querySelector("a")!.getAttribute("href")).toBe(
            "https://dev.azure.com/contoso/Proj/_workitems/edit/7",
        );
    });
});

describe("useUserMentionHydration", () => {
    const GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

    function Pill(): ReactElement {
        const ref = useRef<HTMLDivElement>(null);
        useUserMentionHydration(ref, []);

        return createElement("div", {
            ref,
            dangerouslySetInnerHTML: {
                __html: `<span class="emr-mention" data-mention-kind="user" data-mention-id="${GUID}">@${GUID}</span>`,
            },
        });
    }

    function Host(props: { store: IdentityStore | null }): ReactElement {
        return createElement(
            IdentityStoreContext.Provider,
            { value: props.store },
            createElement(Pill),
        );
    }

    const pillText = (): string | null => container!.querySelector(".emr-mention")!.textContent;

    it("shows the person's name when the identity is already known", () => {
        const store = new IdentityStore();
        store.seed([{ id: GUID, displayName: "Grace Hopper" }]);

        mount(createElement(Host, { store }));

        expect(pillText()).toBe("@Grace Hopper");
    });

    it("swaps the raw id for the person's name once their identity resolves", () => {
        const store = new IdentityStore();
        mount(createElement(Host, { store }));
        expect(pillText()).toBe(`@${GUID}`);

        act(() => store.seed([{ id: GUID, displayName: "Grace Hopper" }]));

        expect(pillText()).toBe("@Grace Hopper");
    });

    it("keeps showing the raw id when no identity store is provided", () => {
        mount(createElement(Host, { store: null }));

        expect(pillText()).toBe(`@${GUID}`);
    });
});
