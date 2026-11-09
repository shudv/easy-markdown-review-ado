// Repairs for Mermaid source that authors routinely get "wrong" in a way the
// Mermaid parser rejects but the author's intent is unambiguous.
//
// Pure (no DOM, no mermaid import) so it stays in the markdown layer and is
// unit-testable. Only ever applied AFTER a diagram has failed to parse — a
// diagram that renders as written is never rewritten.

/**
 * In a sequence diagram Mermaid reads `;` as a statement break, so prose like
 * `A->>B: Admit; require SAW` or `Note over A: true; no moniker` fails with
 * "Parse error … Expecting 'SOLID_ARROW' …" (the most common diagram failure
 * in production). Escape those semicolons as Mermaid's `#59;` entity inside
 * message, note, and block-label text. Leaves a line-ending `;` (a valid
 * statement terminator) and existing entity codes (`#9829;`, `&amp;`) alone.
 *
 * @returns the repaired source, or `null` when `src` isn't a sequence diagram
 *          or there was nothing to repair.
 */
export function repairSequenceSemicolons(src: string): string | null {
    const lines = src.split("\n");
    const header = firstStatementIndex(lines);

    // Stryker disable next-line Regex: dropping the `^` anchor only matters for a header line that mentions "sequenceDiagram" after some other text, and no Mermaid diagram header does — the diagram keyword is always the line's first token.
    // Stryker disable next-line ConditionalExpression: dead code: with no statement (-1), `lines[-1]` is undefined and the header test reads "undefined", which fails anyway; candidate for removal (it only guards the non-null assertion).
    if (header < 0 || !/^\s*sequenceDiagram\b/.test(lines[header]!)) {
        return null;
    }

    let changed = false;

    for (let i = header + 1; i < lines.length; i++) {
        const line = lines[i]!;
        const split = textStart(line);
        // Stryker disable next-line ConditionalExpression,EqualityOperator: dead code: textStart never returns 0, and without this skip a -1 split would only scan the line's last character, where a `;` can never have text after it, so the skip never changes the result; candidate for removal.
        if (split < 0) continue;
        const text = line.slice(split);

        const escaped = text.replace(SEMICOLON_RE, (match, entity?: string) =>
            entity !== undefined ? match : "#59;",
        );

        if (escaped !== text) {
            lines[i] = line.slice(0, split) + escaped;
            changed = true;
        }
    }

    return changed ? lines.join("\n") : null;
}

// A `;` that is not the end of an entity code (`#59;`, `#lt;`, `&amp;`,
// `&#123;`) and still has non-space text after it on the line.
const SEMICOLON_RE = /(#\w+|&#?\w+)?;(?=.*\S)/g;

// Messages: `Alice->>Bob: text`, `A-)B: text`, `A<<->>B: text`, …
// Stryker disable next-line Regex: every two-dash arrow (`-->>`, `--x`, `--)`) contains its one-dash form, so allowing only one dash detects exactly the same lines.
const MESSAGE_ARROW_RE = /(?:<<)?-{1,2}(?:>>|[)>x])/;
const NOTE_RE = /^\s*note\s+(?:left of|right of|over)\b[^:]*:/i;

const BLOCK_RE = /^\s*(?:alt|else|opt|loop|par|and|critical|option|break|box)\b/i;

/** Index where a line's free text begins, or -1 when it carries none. */
function textStart(line: string): number {
    const note = NOTE_RE.exec(line);
    if (note) return note[0].length;
    const block = BLOCK_RE.exec(line);
    if (block) return block[0].length;
    const colon = line.indexOf(":");

    // Stryker disable next-line EqualityOperator: a line that starts with `:` has an empty prefix, which can't contain a message arrow either way.
    if (colon > 0 && MESSAGE_ARROW_RE.test(line.slice(0, colon))) {
        // Stryker disable next-line ArithmeticOperator: starting two characters earlier only adds the actor name's last character and the `:`, and Mermaid actor names can't contain `;`.
        return colon + 1;
    }

    return -1;
}

/** The first line that isn't blank, a `%%` comment, or YAML frontmatter. */
function firstStatementIndex(lines: readonly string[]): number {
    let i = 0;

    // Stryker disable next-line OptionalChaining: `split` always yields at least one line, so `lines[0]` is never undefined.
    if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
        // Stryker disable next-line ConditionalExpression,EqualityOperator: dead code: with an unterminated block the scan would restart at the opening `---`, which is never a sequence header, so this early exit never changes the result (and `end` can't be 0 since j > 0); candidate for removal.
        if (end < 0) return -1;
        i = end + 1;
    }

    for (; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (trimmed && !trimmed.startsWith("%%")) return i;
    }

    // Stryker disable next-line UnaryOperator: returning 1 for a source of only blanks and comments still finds no sequence header there.
    return -1;
}
