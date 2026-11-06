// Tests for the `emr/coverage-ignore-rationale` ESLint rule
// (scripts/eslint-rules/coverage-ignore-rationale.mjs).
//
// @vitest-environment node

import { RuleTester } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

import { coverageIgnoreRationale } from "../scripts/eslint-rules/coverage-ignore-rationale.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("coverage-ignore-rationale meta", () => {
  it("declares a message for every messageId the rule reports", () => {
    expect(Object.keys(coverageIgnoreRationale.meta.messages)).toStrictEqual([
      "missingReason",
      "shortReason",
      "unknownDirective",
      "unmatchedStop",
      "unclosedStart",
      "stopWithText",
    ]);
  });
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
