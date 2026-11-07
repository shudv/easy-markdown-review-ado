// Tests for the `emr/coverage-ignore-rationale` ESLint rule
// (scripts/eslint-rules/coverage-ignore-rationale.mjs).
//
// @vitest-environment node

import { Linter, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import { coverageIgnoreRationale } from "../scripts/eslint-rules/coverage-ignore-rationale.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
    },
});

const REASON = "the SDK host owns this path";

tester.run("coverage-ignore-rationale", coverageIgnoreRationale, {
    valid: [
        `/* v8 ignore next -- ${REASON} */\nconst a = 1;`,
        `/* v8 ignore next 3 -- ${REASON} */\nconst a = 1;`,
        `/* v8 ignore start -- ${REASON} */\nconst a = 1;\n/* v8 ignore stop */`,
        `/* v8 ignore else -- ${REASON} */\nif (x) y();`,
        `/* c8 ignore next -- ${REASON} */\nconst a = 1;`,
        `/* istanbul ignore next -- ${REASON} */\nconst a = 1;`,
        // A reason may wrap across lines inside one block comment.
        `/* v8 ignore next -- the SDK host\n   owns this path */\nconst a = 1;`,
        `const el = <div>{/* v8 ignore next -- ${REASON} */}{x}</div>;`,
        // Prose that merely mentions the syntax isn't a directive.
        "// Every branch carries a `/* v8 ignore` with a rationale.\nconst a = 1;",
        "/* Unrelated block comment */\nconst a = 1;",
    ],
    invalid: [
        {
            code: "/* v8 ignore next */\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
        {
            // A line count is not a reason.
            code: "/* v8 ignore next 2 */\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
        {
            code: "// v8 ignore next\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
        {
            code: "/* v8 ignore next -- */\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
        {
            // Text without the ` -- ` separator isn't treated as a reason.
            code: "/* v8 ignore next because it is hard */\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
        {
            code: "/* v8 ignore next -- defensive */\nconst a = 1;",
            errors: [{ messageId: "shortReason" }],
        },
        {
            code: "/* v8 ignore start */\nconst a = 1;\n/* v8 ignore stop */",
            errors: [{ messageId: "missingReason" }],
        },
        {
            code: `/* v8 ignore start -- ${REASON} */\nconst a = 1;`,
            errors: [{ messageId: "unclosedStart" }],
        },
        {
            code: "const a = 1;\n/* v8 ignore stop */",
            errors: [{ messageId: "unmatchedStop" }],
        },
        {
            code: `/* v8 ignore start -- ${REASON} */\nconst a = 1;\n/* v8 ignore stop -- done here */`,
            errors: [{ messageId: "stopWithText" }],
        },
        {
            code: "/* v8 ignore lines -- this is not a directive */\nconst a = 1;",
            errors: [{ messageId: "unknownDirective" }],
        },
        {
            code: "/* istanbul ignore next */\nconst a = 1;",
            errors: [{ messageId: "missingReason" }],
        },
    ],
});

describe("coverage-ignore-rationale messages", () => {
    function lint(code: string): string[] {
        const linter = new Linter();

        return linter
            .verify(code, {
                plugins: {
                    emr: { rules: { "coverage-ignore-rationale": coverageIgnoreRationale } },
                },
                rules: { "emr/coverage-ignore-rationale": "error" },
            })
            .map((problem) => problem.message);
    }

    it.each([
        {
            name: "shows the developer the exact comment to write for their tool and directive",
            code: "/* c8 ignore start */\nconst a = 1;\n/* c8 ignore stop */",
            expected:
                "Coverage ignore needs a reason in the same comment: `/* c8 ignore start -- <why this can't be reached or tested> */`.",
        },
        {
            name: "tells the developer how many words their reason has and needs",
            code: "/* v8 ignore next -- defensive */\nconst a = 1;",
            expected:
                "Coverage-ignore reason is too short (1 words). Say why this code can't be reached or tested (at least 4 words).",
        },
    ])("$name", ({ code, expected }) => {
        expect(lint(code)).toEqual([expected]);
    });
});
