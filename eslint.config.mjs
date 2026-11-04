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
import emrRules from "./scripts/eslint-rules/coverage-ignore-rationale.mjs";

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

export default tseslint.config(
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
      "**/*.stories.tsx",
      ".storybook/**",
      "*.config.{js,cjs,mjs,ts}",
      "webpack.config.cjs",
      "scripts/**",
    ],
  },

  // Base JS + type-aware TS recommendations, applied only to the typed
  // source/test/e2e files below.
  js.configs.recommended,
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
