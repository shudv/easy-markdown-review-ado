// Behavioural tests for the rich-rendering features of the markdown pipeline:
// inline mention pills, emoji shortcodes, and the synchronous render entry
// point. We assert on the rendered HTML contract (the classes and attributes
// other modules and the stylesheet depend on), driving everything through
// public markdown source rather than internals.

import { describe, it, expect } from "vitest";
import { renderMarkdown, renderMarkdownSync } from "../src/markdown/render";

describe("renderMarkdown — mention pills", () => {
    it("renders a user mention as a non-navigable span with no href", async () => {
        const html = await renderMarkdown("Hi [@alice](mention://user/alice)");
        expect(html).toMatch(/<span[^>]*class="[^"]*emr-mention emr-mention-user[^"]*"/);
        expect(html).toContain('data-mention-kind="user"');
        expect(html).toContain('data-mention-id="alice"');
        // User mentions must not be links.
        expect(html).not.toMatch(/<a[^>]*mention:\/\/user/);
    });

    it("converts a native ADO `@<GUID>` token into a user-mention pill", async () => {
        const guid = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";
        const html = await renderMarkdown(`Please review @<${guid}> thanks`);
        // The pill carries the GUID; the display name is filled in at hydration.
        expect(html).toMatch(/<span[^>]*class="[^"]*emr-mention emr-mention-user[^"]*"/);
        expect(html).toContain(`data-mention-id="${guid}"`);
        // The raw `<GUID>` must NOT survive as dropped/broken HTML.
        expect(html).not.toContain(`&#x3C;${guid}`);
        expect(html).not.toContain(`<${guid}`);
    });

    it("keeps a work-item mention as a new-tab link with a leading state dot", async () => {
        const html = await renderMarkdown("See [#42](mention://workitem/42?stateColor=00ff00)");

        expect(html).toMatch(/<a[^>]*href="mention:\/\/workitem\/42\?stateColor=00ff00"/);
        expect(html).toMatch(/<a[^>]*class="[^"]*emr-mention emr-mention-workitem[^"]*"/);
        expect(html).toContain('data-mention-kind="workitem"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('data-mention-param-state-color="00ff00"');
        // A status dot is injected as the first child, coloured from stateColor.
        expect(html).toMatch(
            /<span[^>]*class="emr-mention-state-dot"[^>]*style="background:#00ff00"/,
        );
    });

    it("adds a PR-status class to the dot of a pull-request mention", async () => {
        const html = await renderMarkdown("PR [!9](mention://pullrequest/9?status=active)");

        expect(html).toMatch(/<span[^>]*class="emr-mention-state-dot emr-pr-state-active"/);
    });

    it("renders a bare state dot for a pull-request mention with no status", async () => {
        const html = await renderMarkdown("PR [!9](mention://pullrequest/9)");
        expect(html).toMatch(/<span[^>]*class="emr-mention-state-dot"/);
        expect(html).not.toMatch(/emr-pr-state-/);
    });

    it("leaves ordinary links untouched", async () => {
        const html = await renderMarkdown("[home](https://example.com)");
        expect(html).toContain('href="https://example.com"');
        expect(html).not.toContain("emr-mention");
    });

    it("leaves a raw-HTML anchor without an href untouched", async () => {
        const html = await renderMarkdown('<a id="top">Top</a>\n');
        expect(html).toMatch(/<a\b[^>]+id="top"[^>]*>Top<\/a>/);
        expect(html).not.toContain("emr-mention");
    });
});

describe("renderMarkdownSync", () => {
    it("produces the same HTML as the async renderer for the same source", async () => {
        const md = "# Title\n\nA [#7](mention://workitem/7) ref.\n";
        expect(renderMarkdownSync(md)).toBe(await renderMarkdown(md));
    });
});

// The shortcode table itself is covered in markdown.emoji.test.ts; these pin
// where in a document shortcodes are (and aren't) converted.
describe("renderMarkdown — emoji shortcodes", () => {
    it("converts shortcodes in prose to emoji", async () => {
        const html = await renderMarkdown("Looks good :eyes: shipping this :tada:");
        expect(html).toContain("Looks good 👀 shipping this 🎉");
    });

    it.each([
        { name: "inline code", markdown: "use `:eyes:` literally" },
        { name: "a fenced code block", markdown: "```\n:eyes: launch\n```" },
    ])("leaves shortcodes inside $name as typed", async ({ markdown }) => {
        const html = await renderMarkdown(markdown);
        expect(html).toContain(":eyes:");
        expect(html).not.toContain("👀");
    });
});
