// Types for coverage-ignore-rationale.mjs, so type-checked tests can import it.
import type { ESLint, Rule } from "eslint";

export declare const MIN_REASON_WORDS: number;

export declare const coverageIgnoreRationale: Rule.RuleModule & {
    meta: Rule.RuleMetaData & { messages: Record<string, string> };
};

declare const plugin: ESLint.Plugin;
export default plugin;
