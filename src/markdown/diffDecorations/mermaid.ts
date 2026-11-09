// Change decoration for rendered Mermaid diagrams.

import {
    classifyBlock,
    coveredByDecoratedAncestor,
    type DecorationPass,
    findInteriorEdit,
    reconstructBlockOriginal,
} from "./pass";
import { DIFF_BLOCK_CLASS, DIFF_MERMAID_CLASS, readSourceSpan } from "./shared";
import { standaloneSource } from "./rendering";

export function decorateMermaidBlock(pass: DecorationPass, el: HTMLElement): void {
    const span = readSourceSpan(el);
    if (!span) return;
    if (coveredByDecoratedAncestor(el)) return;
    const { start, end } = span;
    const interiorEdit = findInteriorEdit(pass, el, start, end);

    const kind = interiorEdit ? "modified" : classifyBlock(start, end, pass.changeRanges);

    if (!kind) return;
    el.classList.add(
        DIFF_BLOCK_CLASS,
        kind === "added" ? "emr-diff-block--added" : "emr-diff-block--modified",
        DIFF_MERMAID_CLASS,
    );
    el.dataset.diffKind = kind;

    // Prefer reconstructing the complete pre-edit fence from the original
    // document so even a one-line edit gets a useful Source > Before view. The
    // diagram's own text is shown without the quote markers or list
    // indentation of the containers it sits in, as its current source is.
    const originalBlock = reconstructBlockOriginal(pass, interiorEdit, start, end);

    const originalSource =
        // Stryker disable next-line StringLiteral: stripping an empty block yields "" too, so the empty-block guard only skips the work
        originalBlock !== null && originalBlock !== ""
            ? stripMermaidFence(standaloneSource(el, originalBlock))
            : "";

    if (originalSource) el.dataset.diffOriginal = originalSource;
    pass.decorated++;
}

/**
 * Strip the fenced-code markers around a Mermaid source block so the modal
 * can diff the raw diagram definitions. Handles both GitHub triple-backtick
 * fences and Azure DevOps `:::mermaid` colon fences. Returns "" when the input
 * has no recognisable diagram body.
 */
export function stripMermaidFence(text: string): string {
    const lines = text.replace(/\s+$/, "").split(/\r\n|\r|\n/);

    // Stryker disable next-line ConditionalExpression,EqualityOperator: dead code: splitting a string always yields at least one line, candidate for removal
    if (lines.length > 0 && /^\s*(?:`{3,}|:{3,})\s*mermaid\b/i.test(lines[0]!)) {
        lines.shift();

        // Stryker disable next-line ConditionalExpression,EqualityOperator,Regex: an empty body's missing last line never tests as a fence; trailing whitespace is already trimmed and a diagram never ends in fence characters followed by text, so the anchors only matter for an indented closing fence, which the indented-fence scenario covers
        if (lines.length > 0 && /^\s*(?:`{3,}|:{3,})\s*$/.test(lines[lines.length - 1]!)) {
            lines.pop();
        }
    }

    return lines.join("\n").trim();
}
