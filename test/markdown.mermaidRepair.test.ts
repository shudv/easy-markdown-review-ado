import { describe, expect, it } from "vitest";

import { repairSequenceSemicolons } from "../src/markdown/mermaidRepair";

describe("repairSequenceSemicolons", () => {
  it("escapes ';' in message text (the production failure)", () => {
    expect(
      repairSequenceSemicolons(
        "sequenceDiagram\n  A->>B: Admit; require SAW; persist\n  B-->>A: ok",
      ),
    ).toBe(
      "sequenceDiagram\n  A->>B: Admit#59; require SAW#59; persist\n  B-->>A: ok",
    );
  });

  it("covers every arrow form, notes, and block labels", () => {
    const src = [
      "sequenceDiagram",
      "  A-)B: async; call",
      "  A-xB: lost; reply",
      "  A<<->>B: both; ways",
      "  Note right of A: true; no moniker",
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
        "  alt ok#59; fast",
        "  else Accepted#59; slow",
        "  end",
      ].join("\n"),
    );
  });

  it("keeps entity codes and a line-ending terminator", () => {
    expect(
      repairSequenceSemicolons(
        "sequenceDiagram\n  A->>B: love #9829; &amp; more; end;",
      ),
    ).toBe("sequenceDiagram\n  A->>B: love #9829; &amp; more#59; end;");
  });

  it("finds the header after frontmatter and %% comments", () => {
    expect(
      repairSequenceSemicolons(
        "---\ntitle: X\n---\n\n%% note\nsequenceDiagram\n  W->>W: Acquire; else",
      ),
    ).toBe(
      "---\ntitle: X\n---\n\n%% note\nsequenceDiagram\n  W->>W: Acquire#59; else",
    );
  });

  it("leaves lines without free text (participants, end, colon-less) alone", () => {
    expect(
      repairSequenceSemicolons(
        "sequenceDiagram\n  participant A; B\n  A->>B\n  x: y; z",
      ),
    ).toBeNull();
  });

  it.each([
    ["a flowchart", "flowchart LR\n  a --> b; b --> c"],
    ["a sequence diagram with nothing to fix", "sequenceDiagram\n  A->>B: hi"],
    [
      "unterminated frontmatter",
      "---\ntitle: X\nsequenceDiagram\n  A->>B: a; b",
    ],
    ["only comments", "%% nothing here\n\n"],
  ])("returns null for %s", (_label, src) => {
    expect(repairSequenceSemicolons(src)).toBeNull();
  });
});
