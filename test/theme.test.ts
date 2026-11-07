// Tests for the theme module's DOM side-effects: mirroring the Azure DevOps host
// theme onto <html> and keeping it in sync as the host changes.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, refreshHostTheme, resolveHostTheme, syncHostTheme } from "../src/theme/theme";

type MatchMediaWindow = { matchMedia?: typeof window.matchMedia };

const restores: Array<() => void> = [];

afterEach(() => {
    restores
        .splice(0)
        .reverse()
        .forEach((restore) => restore());
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-emr-theme");
    document.body.className = "";
});

const themeAttribute = () => document.documentElement.getAttribute("data-emr-theme");

/** Stub the host's injected background colour and accent (`--palette-primary`). */
function stubHostColors(getBackground: () => string, getPrimary: () => string = () => ""): void {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn((_el: Element) => ({
        getPropertyValue: (prop: string) =>
            prop === "--background-color"
                ? getBackground()
                : prop === "--palette-primary"
                  ? getPrimary()
                  : "",
        backgroundColor: getBackground(),
    })) as unknown as typeof getComputedStyle;
    restores.push(() => {
        globalThis.getComputedStyle = original;
    });
}

/** Replace `window.matchMedia` (or remove it, with `undefined`). */
function replaceMatchMedia(matchMedia: unknown): void {
    const original = (window as MatchMediaWindow).matchMedia;

    if (matchMedia === undefined) {
        delete (window as MatchMediaWindow).matchMedia;
    } else {
        (window as unknown as { matchMedia: unknown }).matchMedia = matchMedia;
    }

    restores.push(() => {
        if (original) {
            (window as MatchMediaWindow).matchMedia = original;
        } else {
            delete (window as MatchMediaWindow).matchMedia;
        }
    });
}

/** Stub the OS signals: forced-colors (Windows High Contrast) and dark preference. */
function stubOsColors(
    forced: boolean,
    prefersDark = false,
    onChange: (handler: () => void) => void = () => {},
): void {
    replaceMatchMedia(
        vi.fn((query: string) => ({
            matches: query.includes("forced-colors")
                ? forced
                : query.includes("prefers-color-scheme: dark") && prefersDark,
            media: query,
            addEventListener: (_type: string, handler: () => void) => onChange(handler),
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => false,
        })),
    );
}

describe("applyTheme", () => {
    it.each(["light", "dark"] as const)("marks <html> with the %s theme", (theme) => {
        applyTheme(theme);

        expect(themeAttribute()).toBe(theme);
    });

    it("writes an unknown theme id through without throwing", () => {
        applyTheme("brand-new-theme" as unknown as Parameters<typeof applyTheme>[0]);

        expect(themeAttribute()).toBe("brand-new-theme");
    });
});

describe("resolveHostTheme", () => {
    it.each([
        {
            name: "mirrors a light host background as light",
            background: "rgb(255, 255, 255)",
            expected: "light",
        },
        {
            name: "mirrors a dark host background as dark",
            background: "rgb(10, 10, 10)",
            expected: "dark",
        },
        {
            name: "treats a host without a background colour as light",
            background: "",
            expected: "light",
        },
        // Real ADO behaviour: under forced-colors the host FREEZES the injected
        // `--background-color` at the pre-HC theme's value, so darkness must come
        // from the OS `prefers-color-scheme`. Regression guard for a dark
        // high-contrast desktop that resolved to `hc-light` (white).
        {
            name: "uses the OS dark preference under forced colors, despite a frozen light background",
            background: "rgb(255, 255, 255)",
            forced: true,
            prefersDark: true,
            expected: "hc-dark",
        },
        {
            name: "uses the OS light preference under forced colors",
            background: "rgb(255, 255, 255)",
            forced: true,
            expected: "hc-light",
        },
        // ADO's in-app HC theme is delivered as CSS vars, not OS forced-colors: the
        // accent collapses to grey and a real HC background is injected.
        {
            name: "detects ADO's high-contrast picker from an achromatic accent on light",
            background: "rgb(255, 255, 255)",
            primary: "0, 0, 0",
            expected: "hc-light",
        },
        {
            name: "detects ADO's high-contrast picker from an achromatic accent on dark",
            background: "rgb(0, 0, 0)",
            primary: "255, 255, 255",
            expected: "hc-dark",
        },
        {
            name: "stays on the regular palette when the accent is coloured",
            background: "rgb(255, 255, 255)",
            primary: "0, 120, 212",
            expected: "light",
        },
    ])("$name", ({ background, primary = "", forced = false, prefersDark = false, expected }) => {
        stubHostColors(
            () => background,
            () => primary,
        );
        stubOsColors(forced, prefersDark);

        expect(resolveHostTheme()).toBe(expected);
    });
});

describe("refreshHostTheme", () => {
    it("re-mirrors the host theme onto <html> on demand", () => {
        stubHostColors(() => "rgb(12, 12, 12)");
        stubOsColors(false);

        refreshHostTheme();

        expect(themeAttribute()).toBe("dark");
        expect(document.head.querySelector("style[data-emr-markdown-theme]")).not.toBeNull();
    });
});

describe("syncHostTheme", () => {
    let background = "rgb(255, 255, 255)";

    beforeEach(() => {
        background = "rgb(255, 255, 255)";
        stubHostColors(() => background);
    });

    it("mirrors the host theme straight away", () => {
        stubOsColors(false);

        restores.push(syncHostTheme());

        expect(themeAttribute()).toBe("light");
    });

    it("follows a live host theme switch announced by the SDK's themeApplied event", () => {
        // A reload is NOT required: the themeApplied window event drives the re-sync.
        stubOsColors(false);
        restores.push(syncHostTheme());

        background = "rgb(8, 8, 8)";
        window.dispatchEvent(new Event("themeApplied"));

        expect(themeAttribute()).toBe("dark");
    });

    it("follows the host when it swaps the body's theme class", async () => {
        restores.push(syncHostTheme());

        background = "rgb(10, 10, 10)";
        document.body.className = "vss-theme-dark";
        // MutationObserver in jsdom is async (microtask).
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(themeAttribute()).toBe("dark");
    });

    it("follows the OS colour scheme as soon as it changes", () => {
        const onChange: Array<() => void> = [];
        stubOsColors(false, false, (handler) => onChange.push(handler));
        restores.push(syncHostTheme());

        background = "rgb(10, 10, 10)";
        onChange[0]!();

        expect(themeAttribute()).toBe("dark");
    });

    it("stops following the host once unsubscribed", () => {
        stubOsColors(false);
        const stop = syncHostTheme();

        stop();
        background = "rgb(8, 8, 8)";
        window.dispatchEvent(new Event("themeApplied"));

        expect(themeAttribute()).toBe("light");
    });
});

describe("theme resolution under hostile environments", () => {
    it("treats the host as light when getComputedStyle throws (detached frame)", () => {
        const original = globalThis.getComputedStyle;
        globalThis.getComputedStyle = (() => {
            throw new Error("detached frame");
        }) as unknown as typeof getComputedStyle;
        restores.push(() => {
            globalThis.getComputedStyle = original;
        });
        stubOsColors(false);

        expect(resolveHostTheme()).toBe("light");
    });

    it("treats the host as light when getComputedStyle is unavailable", () => {
        const original = globalThis.getComputedStyle;
        (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle = undefined;
        restores.push(() => {
            globalThis.getComputedStyle = original;
        });
        stubOsColors(false);

        expect(resolveHostTheme()).toBe("light");
    });

    it("judges by background alone when matchMedia is unavailable", () => {
        stubHostColors(() => "rgb(255, 255, 255)");
        replaceMatchMedia(undefined);

        expect(resolveHostTheme()).toBe("light");
    });

    it("still syncs, and cleans up, when matchMedia throws", () => {
        stubHostColors(() => "rgb(255, 255, 255)");
        replaceMatchMedia(() => {
            throw new Error("unsupported query");
        });

        const stop = syncHostTheme();

        expect(themeAttribute()).toBe("light");
        expect(stop).not.toThrow();
    });
});

describe("theme — non-DOM safety", () => {
    it("applyTheme is a no-op when there is no document", () => {
        vi.stubGlobal("document", undefined);

        expect(() => applyTheme("light")).not.toThrow();
    });

    it("refreshHostTheme is a no-op when there is no document", () => {
        vi.stubGlobal("document", undefined);

        expect(() => refreshHostTheme()).not.toThrow();
    });

    it("syncHostTheme returns a safe no-op unsubscribe when there is no document", () => {
        vi.stubGlobal("document", undefined);

        const stop = syncHostTheme();

        expect(stop).not.toThrow();
    });
});

describe("theme — partial DOM environments", () => {
    it.each(["window", "MutationObserver"])(
        "syncHostTheme still mirrors the theme when %s is missing",
        (name) => {
            stubHostColors(() => "rgb(255, 255, 255)");
            vi.stubGlobal(name, undefined);

            const stop = syncHostTheme();

            expect(themeAttribute()).toBe("light");
            expect(stop).not.toThrow();
        },
    );

    it("treats the host as light and observes only <html> when there is no body", () => {
        const body = document.body;
        body.remove();
        restores.push(() => document.documentElement.appendChild(body));

        expect(resolveHostTheme()).toBe("light");
        expect(syncHostTheme()).not.toThrow();
    });
});
