// ESLint rule: every coverage-ignore comment must say why the code it hides
// can't be reached or tested.
//
// Accepted forms (v8, c8 and istanbul spellings alike):
//   /* v8 ignore next -- <reason> */      /* v8 ignore next 3 -- <reason> */
//   /* v8 ignore start -- <reason> */ ... /* v8 ignore stop */
//   /* v8 ignore if|else|file -- <reason> */
// The reason follows ` -- ` in the same comment and needs at least
// MIN_REASON_WORDS words. Each `start` needs a matching `stop` in the file.

export const MIN_REASON_WORDS = 4;

const DIRECTIVE = /^\s*\**\s*(v8|c8|istanbul)\s+ignore\b([\s\S]*)$/;
const KIND = /^\s+(next|start|stop|if|else|file)\b(?:\s+\d+)?([\s\S]*)$/;
const REASON = /^\s*--\s*([\s\S]*?)\s*\**\s*$/;

function parse(comment) {
    const directive = DIRECTIVE.exec(comment.value);
    if (!directive) return null;
    const tool = directive[1];
    const kind = KIND.exec(directive[2]);
    if (!kind) return { tool, kind: null };
    const reason = REASON.exec(kind[2]);
    return {
        tool,
        kind: kind[1],
        reason: reason ? reason[1] : null,
        hasTrailingText: kind[2].trim().length > 0,
    };
}

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/** @type {import("eslint").Rule.RuleModule} */
export const coverageIgnoreRationale = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Require a written reason on every coverage-ignore comment and balanced start/stop pairs",
        },
        schema: [],
        messages: {
            missingReason:
                "Coverage ignore needs a reason in the same comment: `/* {{tool}} ignore {{kind}} -- <why this can't be reached or tested> */`.",
            shortReason:
                "Coverage-ignore reason is too short ({{count}} words). Say why this code can't be reached or tested (at least {{min}} words).",
            unknownDirective:
                "Unrecognised coverage-ignore directive. Use `next [N]`, `start`/`stop`, `if`, `else` or `file`, followed by ` -- <reason>`.",
            unmatchedStop: "`{{tool}} ignore stop` has no matching `start`.",
            unclosedStart: "`{{tool}} ignore start` is never closed by a matching `stop`.",
            stopWithText:
                "`{{tool}} ignore stop` takes no text; put the reason on the matching `start`.",
        },
    },
    create(context) {
        const open = [];
        const report = (comment, messageId, data) =>
            context.report({ loc: comment.loc, messageId, data });

        const checkStop = (comment, { tool, hasTrailingText }) => {
            if (hasTrailingText) report(comment, "stopWithText", { tool });
            if (!open.pop()) report(comment, "unmatchedStop", { tool });
        };

        const checkReason = (comment, { tool, kind, reason }) => {
            if (!reason) {
                report(comment, "missingReason", { tool, kind });
                return;
            }
            const count = wordCount(reason);
            if (count < MIN_REASON_WORDS) {
                report(comment, "shortReason", {
                    count: String(count),
                    min: String(MIN_REASON_WORDS),
                });
            }
        };

        const check = (comment) => {
            const parsed = parse(comment);
            if (!parsed) return;
            if (!parsed.kind) {
                report(comment, "unknownDirective");
                return;
            }
            if (parsed.kind === "stop") {
                checkStop(comment, parsed);
                return;
            }
            if (parsed.kind === "start") open.push({ comment, tool: parsed.tool });
            checkReason(comment, parsed);
        };

        return {
            Program() {
                for (const comment of context.sourceCode.getAllComments()) {
                    check(comment);
                }
            },
            "Program:exit"() {
                for (const { comment, tool } of open) {
                    report(comment, "unclosedStart", { tool });
                }
            },
        };
    },
};

export default {
    rules: { "coverage-ignore-rationale": coverageIgnoreRationale },
};
