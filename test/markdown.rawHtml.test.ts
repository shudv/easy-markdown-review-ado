// Scenario tests for raw HTML blocks that open in one Markdown block and close
// in another (details, tables), driven through public Markdown source and the
// rendered DOM a reader sees.

import { describe, it, expect } from "vitest";
import type { Root, RootContent } from "hast";
import { unified } from "unified";
import { renderMarkdown } from "../src/markdown/render";
import { rehypeSafeHtml } from "../src/markdown/safeHtml";

async function renderDom(markdown: string): Promise<HTMLElement> {
    const root = document.createElement("div");
    root.innerHTML = await renderMarkdown(markdown);

    return root;
}

function follows(earlier: Element, later: Element): boolean {
    return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

const DETAILS_THEN_TEXT = [
    "<details>",
    "<summary>S</summary>",
    "",
    "Body",
    "",
    "</details>",
    "After text",
    "",
    "# Next",
    "",
].join("\n");

describe("raw HTML details closed directly above text", () => {
    it("keeps the body inside the details block", async () => {
        const root = await renderDom(DETAILS_THEN_TEXT);

        expect(root.querySelector("details > p")!.textContent).toBe("Body");
    });

    it("renders the text after </details> outside the details block", async () => {
        const root = await renderDom(DETAILS_THEN_TEXT);

        expect(root.querySelector("details")!.textContent).not.toContain("After text");
        expect(root.textContent).toContain("After text");
    });

    it("renders a later heading after the details block, not inside it", async () => {
        const root = await renderDom(DETAILS_THEN_TEXT);
        const heading = root.querySelector("h1")!;

        expect(heading.closest("details")).toBeNull();
        expect(follows(root.querySelector("details")!, heading)).toBe(true);
    });

    it("reports the details block as ending on its closing-tag line", async () => {
        const root = await renderDom(DETAILS_THEN_TEXT);

        expect(root.querySelector("details")!.getAttribute("data-source-end-line")).toBe("6");
    });

    it("opens a second details block that follows </details> on the next line", async () => {
        const root = await renderDom(
            [
                "<details>",
                "<summary>First</summary>",
                "",
                "One",
                "",
                "</details>",
                "<details>",
                "<summary>Second</summary>",
                "",
                "Two",
                "",
                "</details>",
                "",
            ].join("\n"),
        );

        const blocks = [...root.querySelectorAll("details")];
        expect(blocks.map((block) => block.querySelector("p")!.textContent)).toEqual([
            "One",
            "Two",
        ]);
        expect(blocks[1]!.getAttribute("data-source-line")).toBe("7");
    });

    it("keeps a details block open past a stray closing tag for an element that isn't open", async () => {
        const root = await renderDom(
            ["<details>", "", "Body", "", "</div>", "", "Still inside", "", "</details>", ""].join(
                "\n",
            ),
        );

        expect(root.querySelector("details")!.textContent).toContain("Still inside");
    });

    it("records where the closing tag ends and where the trailing text starts", async () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "raw",
                    value: "<details>",
                    position: {
                        start: { line: 1, column: 1, offset: 0 },
                        end: { line: 1, column: 10, offset: 9 },
                    },
                } as unknown as RootContent,
                { type: "text", value: "Inside" },
                {
                    type: "raw",
                    value: "  </details>  \n<span>After</span>",
                    position: {
                        start: { line: 3, column: 3, offset: 20 },
                        end: { line: 4, column: 19, offset: 52 },
                    },
                } as unknown as RootContent,
            ],
        };

        await unified().use(rehypeSafeHtml).run(tree);

        expect(tree.children.map((node) => node.position)).toEqual([
            { start: { line: 1, column: 1, offset: 0 }, end: { line: 3, column: 15 } },
            { start: { line: 4, column: 1 }, end: { line: 4, column: 19, offset: 52 } },
        ]);
    });
});

describe("raw HTML details opened after an HTML comment", () => {
    it("keeps the body inside a details block whose line starts with a comment", async () => {
        const root = await renderDom(
            ["<!-- c --><details>", "<summary>S</summary>", "", "Body", "", "</details>", ""].join(
                "\n",
            ),
        );

        const details = root.querySelector("details")!;
        expect(details.querySelector("summary")!.textContent).toBe("S");
        expect(details.querySelector("p")!.textContent).toBe("Body");
    });

    it.each(["<!-- end --></details>", "<!-- end --> </details>"])(
        "closes a details block whose closing tag follows a comment: %s",
        async (closing) => {
            const root = await renderDom(
                ["<details>", "", "Body", "", closing, "", "After", ""].join("\n"),
            );

            expect(root.querySelector("details")!.textContent).not.toContain("After");
            expect(root.textContent).toContain("After");
        },
    );

    it("keeps the body inside a details block opened within an unknown wrapper", async () => {
        const root = await renderDom(
            ["<section><details>", "", "Body", "", "</details></section>", "", "After", ""].join(
                "\n",
            ),
        );

        const details = root.querySelector("details")!;
        expect(details.textContent).toContain("Body");
        expect(details.textContent).not.toContain("After");
    });
});

describe("raw HTML table with Markdown cells", () => {
    it.each([
        {
            layout: "the row opened with its first cell",
            markdown: ["<table><tr>", "<td>", "", "**Cell**", "", "</td>", "</tr></table>"],
        },
        {
            layout: "every tag in its own block",
            markdown: ["<table><tr>", "", "<td>", "", "**Cell**", "", "</td>", "", "</tr></table>"],
        },
    ])("keeps the Markdown cell inside its row with $layout", async ({ markdown }) => {
        const root = await renderDom([...markdown, "", "After", ""].join("\n"));

        expect(root.querySelector("table tr > td strong")!.textContent).toBe("Cell");
    });

    it.each([
        {
            layout: "the row opened with its first cell",
            markdown: ["<table><tr>", "<td>", "", "**Cell**", "", "</td>", "</tr></table>"],
        },
        {
            layout: "every tag in its own block",
            markdown: ["<table><tr>", "", "<td>", "", "**Cell**", "", "</td>", "", "</tr></table>"],
        },
    ])("renders content after </table> after the table with $layout", async ({ markdown }) => {
        const root = await renderDom([...markdown, "", "After", ""].join("\n"));
        const after = [...root.querySelectorAll("p")].find((p) => p.textContent === "After")!;

        expect(after.closest("table")).toBeNull();
        expect(follows(root.querySelector("table")!, after)).toBe(true);
    });

    it("closes every implied table part when </table> arrives", async () => {
        const root = await renderDom(
            ["<table>", "<tr>", "<td>", "", "Cell", "", "</table>", "", "# Next", ""].join("\n"),
        );

        expect(root.querySelector("table td")!.textContent).toContain("Cell");
        expect(root.querySelector("h1")!.closest("table")).toBeNull();
    });
});
