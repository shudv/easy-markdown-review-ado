// Flat ESLint config (ESLint 10 + typescript-eslint 8).
//
// Deterministic guardrail: the many `// eslint-disable-next-line` comments
// scattered across src/ and e2e/ were previously decorative — no ESLint was
// wired up. This config makes them real. Type-aware rules run against the
// project's tsconfigs so async/SDK-heavy code gets `no-floating-promises`
// and unsafe-any protection.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import noOnlyTests from "eslint-plugin-no-only-tests";
import sonarjs from "eslint-plugin-sonarjs";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import regexp from "eslint-plugin-regexp";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import eslintReact from "@eslint-react/eslint-plugin";
import vitest from "@vitest/eslint-plugin";
import emrRules from "./scripts/eslint-rules/coverage-ignore-rationale.mjs";

// Every TypeScript file that is type-checked and linted.
const TYPED = [
  "src/**/*.{ts,tsx}",
  "e2e/**/*.ts",
  "visual/**/*.ts",
  "test/**/*.{ts,tsx}",
];
const JSX = ["src/**/*.tsx", "test/**/*.tsx"];
const UNIT_TESTS = ["test/**/*.{ts,tsx}"];
// Stories and Storybook config get only the React import rule below, not the
// type-aware rule set.
const STORIES = ["**/*.stories.tsx", ".storybook/**/*.{ts,tsx}"];

// React is imported by name (`import { useState, type ReactElement } from
// "react"`), never as a namespace or default object, and JSX uses the
// automatic runtime. React types that share a DOM name are aliased, e.g.
// `type MouseEvent as ReactMouseEvent`.
const REACT_NAMED_IMPORTS = [
  "error",
  {
    selector:
      "ImportDeclaration[source.value='react'] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)",
    message:
      'Import React APIs and types by name: `import { useState, type ReactElement } from "react"`.',
  },
  {
    selector:
      ":matches(MemberExpression, JSXMemberExpression)[object.name='React'], TSQualifiedName[left.name='React']",
    message:
      "Use the named import instead of `React.x` (alias DOM-clashing types, e.g. `type MouseEvent as ReactMouseEvent`).",
  },
];

// @eslint-react re-implements several React Compiler rules that
// eslint-plugin-react-hooks already enforces; keep the official ones.
const eslintReactRules = Object.fromEntries(
  Object.entries(eslintReact.configs["recommended-type-checked"].rules).filter(
    ([name]) => !(name.replace("@eslint-react/", "") in reactHooks.rules),
  ),
);

// Complexity and size limits for production source (src/, excluding stories
// and type declarations), enforced as lint errors. Line limits count code
// lines only: blank and comment lines don't count.
const LIMITS = {
  cyclomatic: 15,
  cognitive: 15,
  linesPerFunction: 80,
  params: 4,
  linesPerFile: 500,
};
const CODE_LINES_ONLY = { skipBlankLines: true, skipComments: true };

const config = tseslint.config(
  {
    // An `eslint-disable` the code no longer needs is an error, so documented
    // exceptions can't outlive the problem they excuse.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },

  {
    // Anything generated, vendored, or not source. Config/glue files that are
    // outside the TypeScript projects are excluded so type-aware rules don't
    // fail loading against files with no type information.
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".webpack-cache/**",
      "reports/**",
      "sandbox/**",
      "storybook-static/**",
      "node_modules/**",
      "**/*.d.ts",

      "*.config.{js,cjs,mjs,ts}",
      "webpack.config.cjs",
      "scripts/**",
    ],
  },

  // Base JS + type-aware TS recommendations, applied only to the typed
  // source/test/e2e files below.
  { ...js.configs.recommended, files: TYPED },
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: [
      "src/**/*.{ts,tsx}",
      "e2e/**/*.ts",
      "visual/**/*.ts",
      "test/**/*.{ts,tsx}",
    ],
  })),

  {
    files: [
      "src/**/*.{ts,tsx}",
      "e2e/**/*.ts",
      "visual/**/*.ts",
      "test/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parserOptions: {
        // Type-aware linting. List the projects explicitly so the root
        // (src), test, and e2e tsconfigs are all resolved — the root
        // tsconfig.json excludes test/, so projectService alone can't see
        // those files.
        project: ["./tsconfig.eslint.json", "./e2e/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "no-only-tests": noOnlyTests,
      sonarjs,
    },
    rules: {
      // Classic Rules of Hooks + dependency completeness. A hook after an
      // early return crashes React when that return toggles, so both gate.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // No stray console in shipped code — the codebase already annotates the
      // intentional ones with `// eslint-disable-next-line no-console`.
      "no-console": ["error", { allow: ["warn", "error"] }],

      "no-restricted-syntax": REACT_NAMED_IMPORTS,

      // A stray `.only` silently disables the 100% coverage gate. Hard-fail.
      "no-only-tests/no-only-tests": "error",

      // Intentional throwaways are underscore-prefixed by convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // High-value type-aware rules the codebase already satisfies — these
      // stay hard errors and actively gate.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",

      // Complexity: advisory in tests and e2e; production source is gated as
      // an error in the "Complexity and size gate" block below.
      complexity: ["warn", { max: LIMITS.cyclomatic }],
      "sonarjs/cognitive-complexity": ["warn", LIMITS.cognitive],
      "max-depth": ["error", 5],

      // Type-aware correctness rules. These were warnings while existing
      // sites were cleaned up; all now gate. A genuine exception is an
      // `eslint-disable-next-line <rule> -- <reason>` next to the code.
      //
      //   no-unnecessary-type-assertion / require-await are OFF: they clash
      //   with deliberate defensive `arr[i]!` and async-signature symmetry.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "no-useless-escape": "error",
      "no-useless-assignment": "error",
      "preserve-caught-error": "error",

      // React Compiler rules (react-hooks v7): purity, refs, immutability,
      // effects that set state, and the rest of the recommended set.
      ...reactHooks.configs["recommended-latest"].rules,

      // Stricter type-aware rules.
      "@typescript-eslint/no-unnecessary-condition": "error",
      // `0`, `""` and nullable strings/numbers/objects must be checked
      // explicitly; an optional boolean may stand in for `false`.
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        { allowNullableBoolean: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/return-await": "error",
      "@typescript-eslint/no-misused-spread": "error",
      "@typescript-eslint/no-unnecessary-type-parameters": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/no-useless-default-assignment": "error",
      "@typescript-eslint/no-meaningless-void-operator": "error",
      "@typescript-eslint/no-confusing-non-null-assertion": "error",
      "@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
      "@typescript-eslint/no-dynamic-delete": "error",
      "@typescript-eslint/no-extraneous-class": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/adjacent-overload-signatures": "error",
      "@typescript-eslint/ban-tslint-comment": "error",
      "@typescript-eslint/class-literal-property-style": "error",
      "@typescript-eslint/consistent-generic-constructors": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/prefer-find": "error",
      "@typescript-eslint/prefer-for-of": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/prefer-reduce-type-parameter": "error",
      "@typescript-eslint/prefer-return-this-type": "error",
      "@typescript-eslint/related-getter-setter-pairs": "error",
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/unified-signatures": "error",

      // Core correctness and clarity rules.
      eqeqeq: ["error", "smart"],
      "array-callback-return": "error",
      "default-case-last": "error",
      "logical-assignment-operators": "error",
      "no-alert": "error",
      "no-constructor-return": "error",
      "no-else-return": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-extend-native": "error",
      "no-proto": "error",
      "no-lone-blocks": "error",
      "no-lonely-if": "error",
      "no-return-assign": "error",
      "no-self-compare": "error",
      "no-sequences": "error",
      "no-template-curly-in-string": "error",
      "no-useless-concat": "error",
      "no-useless-rename": "error",
      "no-useless-return": "error",
      "object-shorthand": "error",
      radix: "error",
      yoda: "error",
    },
  },

  {
    // SonarJS recommended set. Rules that duplicate a stricter rule above, or
    // that fight an idiom this codebase uses on purpose, are off.
    files: TYPED,
    rules: {
      ...sonarjs.configs.recommended.rules,
      "sonarjs/cognitive-complexity": "off", // configured above / in the gate
      "sonarjs/deprecation": "off", // @typescript-eslint/no-deprecated
      "sonarjs/no-unused-vars": "off", // @typescript-eslint/no-unused-vars
      "sonarjs/prefer-regexp-exec": "off", // regexp plugin + TS rules
      "sonarjs/super-linear-regex": "off", // regexp/no-super-linear-backtracking is precise
      "sonarjs/different-types-comparison": "off", // misfires on `T | undefined`; TS checks types
      "sonarjs/function-return-type": "off", // components return element | null
      "sonarjs/void-use": "off", // `void promise` marks deliberate fire-and-forget
      "sonarjs/todo-tag": "off", // TODOs are tracked in review, not lint
      "sonarjs/no-alphabetical-sort": "off", // code-unit order is the deterministic order we want
      "sonarjs/no-nested-conditional": "off", // complexity gates bound nesting
    },
  },

  {
    // Regular expressions: correctness, catastrophic backtracking, clarity.
    files: TYPED,
    ...regexp.configs["flat/recommended"],
  },

  {
    // React correctness beyond the hooks rules, and accessibility.
    files: JSX,
    plugins: { ...eslintReact.configs["recommended-type-checked"].plugins },
    settings: eslintReact.configs["recommended-type-checked"].settings,
    rules: eslintReactRules,
  },
  {
    files: JSX,
    plugins: jsxA11y.configs.strict.plugins,
    rules: jsxA11y.configs.strict.rules,
  },

  {
    // Every HTML sink in shipped code (`innerHTML`, `insertAdjacentHTML`, …)
    // must be sanitized or carry a documented exception. Tests build fixtures
    // from literal HTML, so the rule covers production source only.
    files: ["src/**/*.{ts,tsx}"],
    ...noUnsanitized.configs.recommended,
  },
  {
    // Props are read-only: a component must not mutate what it is given.
    files: ["src/**/*.tsx"],
    rules: { "sonarjs/prefer-read-only-props": "error" },
  },

  {
    // Unit tests: every test asserts, titles are unique and valid, and
    // async assertions are awaited.
    files: UNIT_TESTS,
    plugins: vitest.configs.recommended.plugins,
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-conditional-in-test": "error",
      "vitest/prefer-to-be": "error",
    },
  },

  {
    // Every exception says why, next to the code it excuses:
    //   - coverage: `/* v8 ignore next -- <reason> */`, with balanced
    //     `start`/`stop` pairs (a local rule);
    //   - lint: `// eslint-disable-next-line <rule> -- <reason>`, never a bare
    //     or unlimited disable.
    files: [
      "src/**/*.{ts,tsx}",
      "e2e/**/*.ts",
      "visual/**/*.ts",
      "test/**/*.{ts,tsx}",
    ],
    plugins: {
      emr: emrRules,
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "emr/coverage-ignore-rationale": "error",
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-duplicate-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: true },
      ],
    },
  },

  {
    // Complexity and size gate for production source. A deliberate exception
    // is documented in place, e.g. for a component that reads better whole:
    //   // eslint-disable-next-line max-lines-per-function -- <reason>
    // or, for a long file, `/* eslint-disable max-lines -- <reason> */` at the
    // top. Unused disables are errors (see linterOptions above).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.stories.tsx", "src/**/*.d.ts"],
    rules: {
      complexity: ["error", { max: LIMITS.cyclomatic }],
      "sonarjs/cognitive-complexity": ["error", LIMITS.cognitive],
      "max-lines-per-function": [
        "error",
        { max: LIMITS.linesPerFunction, ...CODE_LINES_ONLY },
      ],
      "max-params": ["error", LIMITS.params],
      "max-lines": ["error", { max: LIMITS.linesPerFile, ...CODE_LINES_ONLY }],
    },
  },

  {
    // Tests and e2e are allowed console output and looser any usage.
    files: ["test/**/*.{ts,tsx}", "e2e/**/*.ts", "visual/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },

  {
    // e2e specs must use the shared fixtures, which grant the ADO origin the
    // scoped "local network access" permission the localhost dev iframes need.
    // A spec importing `test` straight from Playwright would silently lose it.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              allowTypeImports: true,
              message:
                'Import `test`/`expect` from "./fixtures" so the spec gets the scoped local-network-access grant.',
            },
          ],
        },
      ],
    },
  },
);

// Every block that targets source files skips stories; stories get a light,
// non-type-aware block with just the React import rule.
export default [
  ...config.map((block) =>
    block.files
      ? { ...block, ignores: [...(block.ignores ?? []), ...STORIES] }
      : block,
  ),
  {
    files: STORIES,
    languageOptions: { parser: tseslint.parser },
    rules: { "no-restricted-syntax": REACT_NAMED_IMPORTS },
  },
];
