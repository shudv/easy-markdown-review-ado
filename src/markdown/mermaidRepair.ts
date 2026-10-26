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
  if (header < 0 || !/^\s*sequenceDiagram\b/.test(lines[header]!)) {
    return null;
  }
  let changed = false;
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const split = textStart(line);
    if (split < 0) continue;
    const text = line.slice(split);
    const escaped = text.replace(SEMICOLON_RE, (match, entity?: string) =>
      entity ? match : "#59;",
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
const MESSAGE_ARROW_RE = /(?:<<)?-{1,2}(?:>>|>|x|\))/;
const NOTE_RE = /^\s*note\s+(?:left of|right of|over)\b[^:]*:/i;
const BLOCK_RE =
  /^\s*(?:alt|else|opt|loop|par|and|critical|option|break|box)\b/i;

/** Index where a line's free text begins, or -1 when it carries none. */
function textStart(line: string): number {
  const note = NOTE_RE.exec(line);
  if (note) return note[0].length;
  const block = BLOCK_RE.exec(line);
  if (block) return block[0].length;
  const colon = line.indexOf(":");
  if (colon > 0 && MESSAGE_ARROW_RE.test(line.slice(0, colon))) {
    return colon + 1;
  }
  return -1;
}

/** The first line that isn't blank, a `%%` comment, or YAML frontmatter. */
function firstStatementIndex(lines: readonly string[]): number {
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end < 0) return -1;
    i = end + 1;
  }
  for (; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed && !trimmed.startsWith("%%")) return i;
  }
  return -1;
}
