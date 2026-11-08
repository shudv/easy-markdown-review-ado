import { describe, expect, it } from "vitest";

import { repairSequenceSemicolons } from "../src/markdown/mermaidRepair";

describe("repairSequenceSemicolons", () => {
    it("escapes ';' in message text (the production failure)", () => {
        expect(
            repairSequenceSemicolons(
                "sequenceDiagram\n  A->>B: Admit; require SAW; persist\n  B-->>A: ok",
            ),
        ).toBe("sequenceDiagram\n  A->>B: Admit#59; require SAW#59; persist\n  B-->>A: ok");
    });

    it("escapes ';' in async, lost and two-way messages, notes, and alt/else labels", () => {
        const src = [
            "sequenceDiagram",
            "  A-)B: async; call",
            "  A-xB: lost; reply",
            "  A<<->>B: both; ways",
            "  Note right of A: true; no moniker",
            "  Note  over A,B: wide; note",
            "  alt ok; fast",
            "  else Accepted; slow",
            "  end",
        ].join("\n");

        expect(repairSequenceSemicolons(src)).toBe(
            [
                "sequenceDiagram",
                "  A-)B: async#59; call",
                "  A-xB: lost#59; reply",
                "  A<<->>B: both#59; ways",
                "  Note right of A: true#59; no moniker",
                "  Note  over A,B: wide#59; note",
                "  alt ok#59; fast",
                "  else Accepted#59; slow",
                "  end",
            ].join("\n"),
        );
    });

    it("escapes a ';' followed by several spaces", () => {
        expect(repairSequenceSemicolons("sequenceDiagram\n  A->>B: wide;  gap")).toBe(
            "sequenceDiagram\n  A->>B: wide#59;  gap",
        );
    });

    it("keeps entity codes and a line-ending terminator, even before trailing spaces", () => {
        expect(
            repairSequenceSemicolons("sequenceDiagram\n  A->>B: love #9829; &amp; more; end;  "),
        ).toBe("sequenceDiagram\n  A->>B: love #9829; &amp; more#59; end;  ");
    });

    it.each([
        {
            name: "after frontmatter and %% comments",
            before: "---\ntitle: X\n---\n\n%% note\n",
            header: "sequenceDiagram",
        },
        {
            name: "right after frontmatter",
            before: "---\ntitle: X\n---\n",
            header: "sequenceDiagram",
        },
        {
            name: "after frontmatter whose fences carry trailing spaces",
            before: "---  \ntitle: X\n--- \n",
            header: "sequenceDiagram",
        },
        {
            name: "indented, after whitespace-only lines and an indented %% comment",
            before: "  \n  %% note\n",
            header: "  sequenceDiagram",
        },
    ])("finds the header $name", ({ before, header }) => {
        expect(repairSequenceSemicolons(`${before}${header}\n  W->>W: Acquire; else`)).toBe(
            `${before}${header}\n  W->>W: Acquire#59; else`,
        );
    });

    it("leaves participants, colon-less lines and commented-out notes alone", () => {
        expect(
            repairSequenceSemicolons(
                "sequenceDiagram\n  participant Inbox; Outbox\n  A->>B; B->>A\n  x: y; z\n  %% Note over A: hidden; for now",
            ),
        ).toBeNull();
    });

    it("leaves a title alone even when its text mentions an arrow", () => {
        expect(
            repairSequenceSemicolons("sequenceDiagram\n  title: Login -> logout; v2"),
        ).toBeNull();
    });

    it.each([
        ["a flowchart", "flowchart LR\n  a --> b; b --> c"],
        [
            "a state diagram whose transition label has ';'",
            "stateDiagram-v2\n  s1 --> s2: go; stop",
        ],
        ["a sequence diagram with nothing to fix", "sequenceDiagram\n  A->>B: hi"],
        ["unterminated frontmatter", "---\ntitle: X\nsequenceDiagram\n  A->>B: a; b"],
        ["frontmatter left open right above the header", "---\nsequenceDiagram\n  A->>B: a; b"],
        ["only comments", "%% nothing here\n\n"],
    ])("returns null for %s", (_label, src) => {
        expect(repairSequenceSemicolons(src)).toBeNull();
    });
});
