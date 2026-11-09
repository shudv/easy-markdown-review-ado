// Fixture comment threads for the standalone dev preview — design.md,
// README.md, api-reference.md and RELEASE_NOTES.md, plus orphaned threads.
// Excerpts are copied verbatim from the fixture Markdown files (see
// ../fixtures.ts).

import type { CommentThread } from "../../types";
import { FIXTURE_AUTHORS, like } from "./people";

/** design.md and README.md threads. */
export const DESIGN_THREADS: CommentThread[] = [
    {
        id: "t-1",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "Word-doc-style review",
            prefix: "We want ",
            suffix: " of Markdown files",
        },
        comments: [
            {
                id: "t-1-c1",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    "Love this framing — should we call out that this is **opt-in** per repo? Don't want it to surprise teams that prefer the diff view.",
                createdAt: "2026-05-18T15:22:00.000Z",
                reactions: [like("u-jamie", "u-priya")],
            },
            {
                id: "t-1-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Good call. Repo admins enable the tab; if disabled the existing diff is unchanged.",
                createdAt: "2026-05-18T16:01:00.000Z",
                reactions: [like("u-alex", "u-jamie")],
            },
        ],
    },
    {
        id: "t-2",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "rendered preview, not the raw source",
            prefix: "Reviewers comment on the ",
            suffix: ".\n",
        },
        comments: [
            {
                id: "t-2-c1",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown:
                    "How does this interact with fenced code blocks? Reviewers might want to comment on raw YAML inside a fence.",
                createdAt: "2026-05-18T18:44:00.000Z",
            },
        ],
    },
    {
        id: "t-3",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "fuzzy match",
            prefix: "TextQuoteSelector model with ",
            suffix: " fallback:",
        },
        comments: [
            {
                id: "t-3-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    "Can we surface a small badge when a comment was re-anchored via fuzzy match? Helps reviewers spot drift.",
                createdAt: "2026-05-19T09:12:00.000Z",
                reactions: [like("u-shubhd", "u-jamie")],
            },
        ],
    },
    {
        id: "t-4",
        filePath: "/docs/design.md",
        status: "resolved",
        anchor: {
            exact: "TextQuoteSelector",
            prefix: "We follow the W3C Web Annotation ",
            suffix: " model with",
        },
        comments: [
            {
                id: "t-4-c1",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown: "Should we use hypothes.is's selector library, or write our own?",
                createdAt: "2026-05-15T11:00:00.000Z",
            },
            {
                id: "t-4-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Our own — small enough, and we get to keep the dependency footprint tiny.",
                createdAt: "2026-05-15T11:18:00.000Z",
            },
            {
                id: "t-4-c3",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown: "Resolved — agreed, let's roll our own. 👍",
                createdAt: "2026-05-15T11:25:00.000Z",
            },
        ],
    },
    {
        id: "t-5",
        filePath: "/README.md",
        status: "active",
        anchor: {
            exact: "standalone dev preview",
            prefix: "sample Markdown files served by the ",
            suffix: ". The standalone preview",
        },
        comments: [
            {
                id: "t-5-c1",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown:
                    "Add a screenshot here once we have the UI ready — keeps the README scannable.",
                createdAt: "2026-05-19T10:01:00.000Z",
            },
        ],
    },
];

// ---- api-reference.md: short, technical threads -----------------------
export const API_REFERENCE_THREADS: CommentThread[] = [
    {
        id: "t-api-1",
        filePath: "/docs/api-reference.md",
        status: "active",
        anchor: {
            exact: "Functions are documented with their signature",
            prefix: "- ",
            suffix: ", semantics",
        },
        comments: [
            {
                id: "t-api-1-c1",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown:
                    "Can we automate this with `typedoc` and just check the generated reference in? Manually keeping it up to date is going to slip.",
                createdAt: "2026-05-19T09:00:00.000Z",
            },
            {
                id: "t-api-1-c2",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    "Tried — `typedoc`'s default markdown is hostile to anchoring (every signature is one giant `<pre>`). Worth its own thread.",
                createdAt: "2026-05-19T09:08:00.000Z",
            },
        ],
    },
    {
        id: "t-api-2",
        filePath: "/docs/api-reference.md",
        status: "active",
        anchor: {
            exact: "blocks the main thread",
            prefix: "Sync variant for short bodies (e.g. comment bodies). Significantly\nslower per byte than the async version because it ",
            suffix: ", so reserve it",
        },
        comments: [
            {
                id: "t-api-2-c1",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    "Worth measuring at what body length the sync variant becomes a perceptible jank. I'd guess > 4 KB.",
                createdAt: "2026-05-18T22:00:00.000Z",
            },
            {
                id: "t-api-2-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Measured: 1 ms at 1 KB, 4 ms at 4 KB, 18 ms at 16 KB on a baseline M1. Will inline these numbers in the doc.",
                createdAt: "2026-05-18T22:30:00.000Z",
                reactions: [like("u-kenji", "u-priya")],
            },
        ],
    },
    {
        id: "t-api-3",
        filePath: "/docs/api-reference.md",
        status: "active",
        anchor: {
            exact: "the type is a string union with one\nmember so the surrounding code can grow without churn",
            prefix: "(Today only `like` round-trips; ",
            suffix: ".)",
        },
        comments: [
            {
                id: "t-api-3-c1",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    "I keep getting bit by this pattern. Maybe a brief comment in the source explaining *why* a one-member union? Future me will thank present us.",
                createdAt: "2026-05-17T16:00:00.000Z",
            },
        ],
    },
    {
        id: "t-api-4",
        filePath: "/docs/api-reference.md",
        status: "resolved",
        anchor: {
            exact: "ADO has `byDesign` which we map to `wontFix`",
            prefix: "- `CommentThread.status` ↔ `GitPullRequestCommentThread.status`.\n  ",
            suffix: ";",
        },
        comments: [
            {
                id: "t-api-4-c1",
                author: FIXTURE_AUTHORS.rosa!,
                bodyMarkdown:
                    "Triple-check this is the mapping the rest of the org uses — some legacy code maps `byDesign` to `closed`.",
                createdAt: "2026-05-14T08:00:00.000Z",
            },
            {
                id: "t-api-4-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    'Confirmed with the ADO product team. `byDesign` → `wontFix` is the canonical mapping. `closed` is reserved for "author decided not to act".',
                createdAt: "2026-05-14T08:14:00.000Z",
                reactions: [like("u-rosa")],
            },
            {
                id: "t-api-4-c3",
                author: FIXTURE_AUTHORS.rosa!,
                bodyMarkdown: "Resolved.",
                createdAt: "2026-05-14T08:15:00.000Z",
            },
        ],
    },
    {
        id: "t-api-5",
        filePath: "/docs/api-reference.md",
        status: "active",
        anchor: {
            exact: "Stability promise",
            prefix: "## ",
            suffix: "\n",
        },
        comments: [
            {
                id: "t-api-5-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    "Should we publish a `CHANGELOG.md` template and link it from here? Reviewers always ask where the history is.",
                createdAt: "2026-05-19T11:14:00.000Z",
                reactions: [like("u-shubhd", "u-alex")],
            },
        ],
    },
];

// ---- /RELEASE_NOTES.md: short threads ---------------------------------
export const RELEASE_NOTES_THREADS: CommentThread[] = [
    {
        id: "t-rel-1",
        filePath: "/RELEASE_NOTES.md",
        status: "active",
        anchor: {
            exact: "Filter chips",
            prefix: "- ",
            suffix: ': "this PR only"',
        },
        comments: [
            {
                id: "t-rel-1-c1",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown: "Should we list each chip on a sub-bullet? One line gets dense.",
                createdAt: "2026-05-19T08:30:00.000Z",
            },
        ],
    },
    {
        id: "t-rel-2",
        filePath: "/RELEASE_NOTES.md",
        status: "active",
        anchor: {
            exact: "Iteration 1",
            prefix: "## ",
            suffix: "\n",
        },
        comments: [
            {
                id: "t-rel-2-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    "Add the ship date next to each iteration heading? Helps me grep when things landed.",
                createdAt: "2026-05-19T11:00:00.000Z",
                reactions: [like("u-shubhd")],
            },
        ],
    },
];

// ---- additional design.md threads -------------------------------------
export const MORE_DESIGN_THREADS: CommentThread[] = [
    {
        id: "t-design-6",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "structural anchor: heading-path + block-index within section",
            prefix: "T3   | ",
            suffix: " | The whole paragraph",
        },
        comments: [
            {
                id: "t-design-6-c1",
                author: FIXTURE_AUTHORS.sven!,
                bodyMarkdown:
                    "Question: if two headings have the same text (e.g. two `### Notes`), how does the path disambiguate?",
                createdAt: "2026-05-19T07:00:00.000Z",
            },
            {
                id: "t-design-6-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    'Index suffix: `["Goals", "Notes#2"]`. Documented in `architecture.md` under "Structural anchor".',
                createdAt: "2026-05-19T07:14:00.000Z",
                reactions: [like("u-sven")],
            },
        ],
    },
    {
        id: "t-design-7",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "Task lists",
            prefix: "- [x] ",
            suffix: "\n- [x] Tables",
        },
        comments: [
            {
                id: "t-design-7-c1",
                author: FIXTURE_AUTHORS.bot!,
                bodyMarkdown:
                    "**Markdown Review Bot:** linked work items detected — [#11611820 Reviewer can @mention teammates in a comment](mention://workitem/11611820?type=User+Story&state=Resolved&stateColor=%23339933). Consider linking the PR description to this work item.",
                createdAt: "2026-05-19T06:00:00.000Z",
            },
        ],
    },
];

/** A thread whose anchor no longer matches — exercises the "orphaned" UI. */
export const ORPHAN_THREADS: CommentThread[] = [
    {
        id: "o-1",
        filePath: "/docs/design.md",
        status: "active",
        anchor: {
            exact: "this exact phrase doesn't exist anywhere",
            prefix: "before context that doesn't match either ",
            suffix: " and neither does the suffix",
        },
        comments: [
            {
                id: "o-1-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    "This comment was anchored to a paragraph that was deleted. Should be surfaced in the 'Orphaned' tray.",
                createdAt: "2026-05-17T12:00:00.000Z",
            },
        ],
    },
    {
        id: "o-2",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "the diagram-rendering subsystem we removed in PR #19",
            prefix: "We used to talk about ",
            suffix: " in this section.",
        },
        comments: [
            {
                id: "o-2-c1",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    "This thread was anchored to a paragraph about a subsystem we removed when we rewrote the architecture doc. Keeping it here as a breadcrumb for anyone looking through the history.",
                createdAt: "2026-04-30T10:00:00.000Z",
                reactions: [like("u-shubhd")],
            },
            {
                id: "o-2-c2",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    'Should we re-anchor this to the "Open questions" section? The conversation is still relevant.',
                createdAt: "2026-04-30T10:30:00.000Z",
            },
        ],
    },
    {
        id: "o-3",
        filePath: "/docs/spec-rfc.md",
        status: "active",
        anchor: {
            exact: "an analytics dashboard for comment hygiene",
            prefix: "And we'd love ",
            suffix: " — coming Q4.",
        },
        comments: [
            {
                id: "o-3-c1",
                author: FIXTURE_AUTHORS.bot!,
                bodyMarkdown:
                    '**Markdown Review Bot:** the paragraph this thread was anchored to no longer exists in the current file. The closest match is the "Filtering" section but the similarity score (0.18) was below the threshold.',
                createdAt: "2026-05-19T05:00:00.000Z",
            },
        ],
    },
    {
        id: "o-4",
        filePath: "/docs/api-reference.md",
        status: "active",
        anchor: {
            exact: "deprecated wrappers around resolveAnchor",
            prefix: "All three ",
            suffix: " should be removed.",
        },
        comments: [
            {
                id: "o-4-c1",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    "Cleanup from a refactor that already landed. Safe to ignore — leaving here so the team knows the wrappers are gone for good.",
                createdAt: "2026-04-10T09:00:00.000Z",
            },
        ],
    },
];
