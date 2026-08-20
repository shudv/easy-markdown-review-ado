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

export default tseslint.config(
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
    },
    rules: {
      // Classic Rules of Hooks + dependency completeness. The existing
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in
      // the codebase were written against exactly these two rules.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",

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

      // Complexity budget: a deterministic "split this" signal.
      complexity: ["warn", { max: 25 }],
      "max-depth": ["warn", 5],

      // --- Ratchet backlog (warn, not error) ------------------------------
      // These fire against pre-existing, intentional code. Kept as warnings so
      // the gate is green today and the findings stay visible; fix a rule's
      // sites, then flip it to "error" to tighten the ratchet — one rule at a
      // time, never a big-bang. New code should avoid adding to these.
      //
      //   no-unnecessary-type-assertion / require-await are OFF: they clash
      //   with deliberate defensive `arr[i]!` and async-signature symmetry.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },

  {
    // Tests and e2e are allowed console output and looser any usage.
    files: ["test/**/*.{ts,tsx}", "e2e/**/*.ts", "visual/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },
);
