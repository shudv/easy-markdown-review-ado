// Unit tests for the "Markdown Review ↗" link on threads started here
// (src/shell/backLink.ts): appended between markers for ADO's own comment UI,
// stripped wherever the app reads a comment, kept across edits, and naming
// its thread by a key written before ADO assigns the thread's id.

import { describe, expect, it } from "vitest";

import {
    backLinkUrl,
    isLinkKey,
    newLinkKey,
    splitBackLink,
    stripBackLink,
    threadIdForLink,
    withBackLink,
} from "../src/shell/backLink";

const DOC = "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=r&path=a.md";
const START = "<!-- emr:back-link -->";
const END = "<!-- /emr:back-link -->";

/** A marked block holding any design, as a later version might write it. */
function marked(inner: string): string {
    return `${START}\n${inner}\n${END}`;
}

describe("withBackLink", () => {
    it("ends the comment with the link chip between the markers", () => {
        const stored = withBackLink("Looks good.\n", DOC);

        expect(stored.startsWith(`Looks good.\n\n${START}\n<a href="${DOC}" `)).toBe(true);
        expect(stored.endsWith(`>Open in Markdown Review ↗</code></a>\n${END}`)).toBe(true);
    });

    it("keeps the link's attribute closed whatever the URL holds", () => {
        expect(withBackLink("Hi", 'https://x.example/?q="a"')).toContain(
            'href="https://x.example/?q=%22a%22"',
        );
    });

    it.each([
        { name: "no URL", url: undefined },
        { name: "a blank URL", url: "" },
        {
            name: "a URL too long for the link to be recognised",
            url: `${DOC}&p=${"x".repeat(1000)}`,
        },
    ])("leaves the comment unchanged with $name", ({ url }) => {
        expect(withBackLink("Looks good.\n", url)).toBe("Looks good.\n");
    });

    it("fits a long document link", () => {
        const url = `${DOC}&p=${"x".repeat(600)}`;

        expect(splitBackLink(withBackLink("Hi", url)).body).toBe("Hi");
    });
});

describe("splitBackLink", () => {
    it("separates what the author wrote from the link, losing nothing", () => {
        const body = "Can we **split** this?\n\n- one\n- two";
        const stored = withBackLink(body, DOC);
        const { body: written, footer } = splitBackLink(stored);

        expect(written).toBe(body);
        expect(written + footer).toBe(stored);
    });

    it.each([
        { name: "a small link", inner: `<sub>[Markdown Review ↗](${DOC})</sub>` },
        { name: "an older design", inner: `_[View in Markdown Review](${DOC})_` },
        { name: "a multi-line design", inner: `---\n📝 Commented in [Markdown Review](${DOC})` },
    ])("recognises the link by its markers alone: $name", ({ inner }) => {
        expect(splitBackLink(`Hi\n\n${marked(inner)}`).body).toBe("Hi");
    });

    it("finds the link after ADO trims or pads the trailing whitespace", () => {
        expect(splitBackLink(`Hi\n\n${marked("link")}  \n`).body).toBe("Hi");
        expect(splitBackLink(`Hi${START}link${END}`).body).toBe("Hi");
    });

    it("takes only the last marked block", () => {
        const earlier = `Quoting: ${marked("old")}`;

        expect(splitBackLink(`${earlier}\n\n${marked("link")}`).body).toBe(earlier);
    });

    it("holds a block right at the size limit", () => {
        const inner = "x".repeat(1000 - START.length - END.length - 2);

        expect(splitBackLink(`Hi\n\n${marked(inner)}`).body).toBe("Hi");
    });

    it.each([
        { name: "a comment without one", content: "Just a comment" },
        { name: "text written after the link", content: `Hi\n\n${marked("link")}\nP.S. one more` },
        { name: "only a start marker", content: `Hi\n\n${START}\nlink` },
        { name: "only an end marker", content: `Hi\n\nlink\n${END}` },
        { name: "markers in the wrong order", content: `Hi\n\n${END}\nlink\n${START}` },
        { name: "a block over the size limit", content: `Hi\n\n${marked("x".repeat(1000))}` },
        {
            name: "the link without markers",
            content: `Hi\n\n<sub>[Markdown Review ↗](${DOC})</sub>`,
        },
    ])("shows $name whole", ({ content }) => {
        expect(splitBackLink(content)).toEqual({ body: content, footer: "" });
    });
});

describe("stripBackLink", () => {
    it("returns what the author wrote", () => {
        expect(stripBackLink(withBackLink("Ship it", DOC))).toBe("Ship it");
    });

    it("keeps a link-only comment empty rather than showing the link", () => {
        expect(stripBackLink(withBackLink("", DOC))).toBe("");
    });
});

describe("newLinkKey", () => {
    it("makes a short, URL-safe key that can't be mistaken for an ADO thread id", () => {
        expect(newLinkKey()).toMatch(/^k-[\da-f]{12}$/);
    });

    it("makes a different key each time", () => {
        expect(newLinkKey()).not.toBe(newLinkKey());
    });
});

describe("backLinkUrl", () => {
    it("opens the document with the thread selected by its key", () => {
        const url = new URL(backLinkUrl(DOC, "k-0123456789ab")!);

        expect(url.searchParams.get("path")).toBe("a.md");
        expect(url.searchParams.get("comment")).toBe("k-0123456789ab");
    });

    it("has no link without a document URL", () => {
        expect(backLinkUrl(undefined, "k-0123456789ab")).toBeUndefined();
    });
});

describe("threadIdForLink", () => {
    const threads = { "12": { linkKey: "k-aaaaaaaaaaaa" }, "13": {} };

    it.each([
        { name: "a thread id", linked: "13", id: "13" },
        { name: "a thread id no thread has yet", linked: "99", id: "99" },
        { name: "a back link's key", linked: "k-aaaaaaaaaaaa", id: "12" },
        {
            name: "a key no thread carries, unchanged",
            linked: "k-bbbbbbbbbbbb",
            id: "k-bbbbbbbbbbbb",
        },
    ])("resolves $name", ({ linked, id }) => {
        expect(threadIdForLink(linked, threads)).toBe(id);
    });
});

describe("isLinkKey", () => {
    it.each([
        { linked: newLinkKey(), key: true },
        { linked: "k-0123456789ab", key: true },
        { linked: "851", key: false },
        { linked: "t-active", key: false },
    ])("tells $linked is a back link's key: $key", ({ linked, key }) => {
        expect(isLinkKey(linked)).toBe(key);
    });
});
