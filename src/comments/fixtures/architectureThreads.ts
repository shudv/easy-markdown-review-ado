// Fixture comment threads for the standalone dev preview — architecture.md.
// Excerpts are copied verbatim from the fixture Markdown files (see
// ../fixtures.ts).

import type { CommentThread } from "../../types";
import { FIXTURE_AUTHORS, like } from "./people";

// ---- architecture.md: long, mention-heavy, multi-author threads -------
export const ARCHITECTURE_THREADS: CommentThread[] = [
    {
        id: "t-arch-1",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "rendered, Word-doc-style review surface",
            prefix: "swaps the default ADO diff view for a ",
            suffix: " for Markdown files",
        },
        comments: [
            {
                id: "t-arch-1-c1",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    "Strong opening — this is the line I'd put on the marketplace listing.",
                createdAt: "2026-05-18T08:14:00.000Z",
                reactions: [like("u-shubhd", "u-alex", "u-priya", "u-jamie", "u-lila")],
            },
            {
                id: "t-arch-1-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Lifted into the listing in [!5058641 Surface unresolved threads in the file tree](mention://pullrequest/5058641?status=completed&repo=OneTodo) — feel free to wordsmith.",
                createdAt: "2026-05-18T08:22:00.000Z",
                updatedAt: "2026-05-18T08:30:00.000Z",
            },
        ],
    },
    {
        id: "t-arch-2",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "the source of truth never leaves the Git repository",
            prefix: "is simple: **",
            suffix: ", and the",
        },
        comments: [
            {
                id: "t-arch-2-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    "I keep getting asked whether we plan to bolt on a search index for comments. The answer is no — and I think this principle is the reason. Can we say it more explicitly somewhere?",
                createdAt: "2026-05-17T11:02:00.000Z",
            },
            {
                id: "t-arch-2-c2",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    '+1. We get asked this on every architecture review.\n\nMaybe add a short "Non-goals" subsection right after 1.1?',
                createdAt: "2026-05-17T11:30:00.000Z",
                reactions: [like("u-priya", "u-morgan")],
            },
            {
                id: "t-arch-2-c3",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Tracking as [#11612051 App caching scenarios](mention://workitem/11612051?type=Scenario&state=In+Progress&stateColor=%23cc6d00). I want to keep this short here and move the depth into the work item description.",
                createdAt: "2026-05-17T12:01:00.000Z",
            },
            {
                id: "t-arch-2-c4",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown:
                    'Re-reading this thread a week later: the principle is doing a lot of load-bearing work. Worth its own section called "Architectural principles"?',
                createdAt: "2026-05-19T09:14:00.000Z",
            },
            {
                id: "t-arch-2-c5",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    "Disagree on the section — it's one sentence, a section would dilute it. Could we bold *the entire sentence* instead?",
                createdAt: "2026-05-19T09:40:00.000Z",
                reactions: [like("u-shubhd")],
            },
            {
                id: "t-arch-2-c6",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Bolded. cc [@Jamie Chen](mention://user/u-jamie) — does that read well?",
                createdAt: "2026-05-19T09:52:00.000Z",
            },
            {
                id: "t-arch-2-c7",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown: "Yes, much better.",
                createdAt: "2026-05-19T10:11:00.000Z",
                reactions: [like("u-shubhd", "u-morgan")],
            },
            {
                id: "t-arch-2-c8",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    'Late to this — small nit: the sentence ends with "nothing more, nothing less." Is that one sentence too rhetorical? I\'d cut it.',
                createdAt: "2026-05-19T15:00:00.000Z",
            },
            {
                id: "t-arch-2-c9",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    "Keep it — it's the line that survives skimming. We need a couple of those.",
                createdAt: "2026-05-19T15:08:00.000Z",
                reactions: [like("u-shubhd", "u-priya", "u-morgan", "u-lila")],
            },
        ],
    },
    {
        id: "t-arch-3",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "intentionally narrow at the bottom",
            prefix: "into four layers, ",
            suffix: " and intentionally generous at the top",
        },
        comments: [
            {
                id: "t-arch-3-c1",
                author: FIXTURE_AUTHORS.lila!,
                bodyMarkdown:
                    "I like the shape but the diagram is doing a lot of work. Would a Mermaid graph render here once we plug in `rehype-mermaid`?",
                createdAt: "2026-05-18T13:00:00.000Z",
            },
            {
                id: "t-arch-3-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Mermaid is on the iteration-4 plan. Want to keep the ASCII for now so this doc renders identically in every Markdown tool.",
                createdAt: "2026-05-18T13:14:00.000Z",
            },
        ],
    },
    {
        id: "t-arch-4",
        filePath: "/docs/architecture.md",
        status: "resolved",
        anchor: {
            exact: "free of React",
            prefix: "intentionally **",
            suffix: "**",
        },
        comments: [
            {
                id: "t-arch-4-c1",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    "Strong opinion: this constraint pays for itself ~3x. Every time we've leaked React into the primitives layer we've paid for it on tests.",
                createdAt: "2026-05-10T08:00:00.000Z",
                reactions: [like("u-shubhd", "u-alex", "u-priya")],
            },
            {
                id: "t-arch-4-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Agreed — codified in `tsconfig.json` `exclude` rules per [#11611998 Wire up identity picker SDK service](mention://workitem/11611998?type=Task&state=To+Do&stateColor=%23b2b2b2).",
                createdAt: "2026-05-10T08:22:00.000Z",
            },
            {
                id: "t-arch-4-c3",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown: "Resolved.",
                createdAt: "2026-05-10T08:30:00.000Z",
            },
        ],
    },
    {
        id: "t-arch-5",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "Anchors are immutable from the writer's perspective.",
            prefix: "- **",
            suffix: "** Once a",
        },
        comments: [
            {
                id: "t-arch-5-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown:
                    'What about the "Re-anchor" affordance on orphaned cards (section 2.4)? Doesn\'t that mutate the anchor?',
                createdAt: "2026-05-18T16:14:00.000Z",
            },
            {
                id: "t-arch-5-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Re-anchor writes a **new** anchor and preserves the old one in the migration history. The original is still immutable. I'll clarify the wording.",
                createdAt: "2026-05-18T16:30:00.000Z",
                reactions: [like("u-priya")],
            },
        ],
    },
    {
        id: "t-arch-6",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "the threshold debate",
            prefix: "#### 2.2.1 ",
            suffix: "\n",
        },
        comments: [
            {
                id: "t-arch-6-c1",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    "Could we surface the threshold in a settings dropdown? Some teams may want stricter or looser anchoring.",
                createdAt: "2026-05-15T10:00:00.000Z",
            },
            {
                id: "t-arch-6-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Strong no for v1. A user-tunable threshold is a giant correctness footgun: comments anchored under one threshold will silently re-anchor differently under another. Hard to debug.",
                createdAt: "2026-05-15T10:14:00.000Z",
                reactions: [like("u-priya", "u-morgan", "u-kenji")],
            },
            {
                id: "t-arch-6-c3",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown:
                    'Fair. Counter-proposal: instead of a slider, a binary "strict" toggle that maps to 0.85.',
                createdAt: "2026-05-15T10:20:00.000Z",
            },
            {
                id: "t-arch-6-c4",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Still no, sorry. We have zero telemetry on what 0.85 would do to the long tail of comments. A toggle ships with the same correctness risk plus the operational risk of two code paths.",
                createdAt: "2026-05-15T10:28:00.000Z",
                reactions: [like("u-kenji")],
            },
            {
                id: "t-arch-6-c5",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    "Suggest we revisit when we have a year of production data. Park as a follow-up?",
                createdAt: "2026-05-15T10:40:00.000Z",
            },
            {
                id: "t-arch-6-c6",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Parked. Filed [#11611702 Inline image attachments on PR comments](mention://workitem/11611702?type=Feature&state=In+Progress&stateColor=%23cc6d00) as the umbrella — wrong title, will rename.",
                createdAt: "2026-05-15T10:42:00.000Z",
            },
            {
                id: "t-arch-6-c7",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Renamed the work item. Linked from the issue. Keeping this thread open as the canonical place for the debate.",
                createdAt: "2026-05-15T10:48:00.000Z",
                updatedAt: "2026-05-15T11:00:00.000Z",
                reactions: [like("u-alex", "u-morgan")],
            },
            {
                id: "t-arch-6-c8",
                author: FIXTURE_AUTHORS.sven!,
                bodyMarkdown:
                    'Coming in cold — has anyone considered using ada-style suffix arrays for the fuzzy match? Could give us "strict" mode for free at O(n) memory.',
                createdAt: "2026-05-16T07:30:00.000Z",
            },
            {
                id: "t-arch-6-c9",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    "Tried it as a spike. Suffix array build dominates the budget on docs > 5,000 lines.",
                createdAt: "2026-05-16T07:48:00.000Z",
            },
            {
                id: "t-arch-6-c10",
                author: FIXTURE_AUTHORS.sven!,
                bodyMarkdown: "Ack — withdrawing.",
                createdAt: "2026-05-16T07:50:00.000Z",
                reactions: [like("u-kenji", "u-shubhd")],
            },
        ],
    },
    {
        id: "t-arch-7",
        filePath: "/docs/architecture.md",
        status: "pending",
        anchor: {
            exact: "0.74",
            prefix: "we settled on **",
            suffix: "** (where 1.0 is identical",
        },
        comments: [
            {
                id: "t-arch-7-c1",
                author: FIXTURE_AUTHORS.bot!,
                bodyMarkdown:
                    "**Markdown Review Bot:** the configured threshold in `anchor.ts` is `0.78`, but this doc says `0.74`. Please reconcile before merging.",
                createdAt: "2026-05-19T11:00:00.000Z",
            },
        ],
    },
    {
        id: "t-arch-8",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "Orphans can be **re-anchored**",
            prefix: "the reader still has the context.\n\n",
            suffix: " by clicking",
        },
        comments: [
            {
                id: "t-arch-8-c1",
                author: FIXTURE_AUTHORS.lila!,
                bodyMarkdown:
                    "Tested re-anchor on a deleted section in [!5058833 [Grid] Implement add task in plan and myday, mytasks views using dom-based AddTaskRow instead of canvas](mention://pullrequest/5058833?status=active&repo=OneTodo) — works end to end. Nice touch keeping the migration history.",
                createdAt: "2026-05-18T12:00:00.000Z",
                reactions: [like("u-shubhd", "u-priya")],
            },
        ],
    },
    {
        id: "t-arch-9",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "Rendering is deliberately boring.",
            prefix: "## 3. Rendering pipeline\n\n",
            suffix: " Every fancy thing",
        },
        comments: [
            {
                id: "t-arch-9-c1",
                author: FIXTURE_AUTHORS.alex!,
                bodyMarkdown: "Best section opener I've read this quarter.",
                createdAt: "2026-05-19T10:30:00.000Z",
                reactions: [
                    like(
                        "u-shubhd",
                        "u-priya",
                        "u-morgan",
                        "u-jamie",
                        "u-sven",
                        "u-lila",
                        "u-kenji",
                        "u-rosa",
                    ),
                ],
            },
        ],
    },
    {
        id: "t-arch-10",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "HTML is never rendered.",
            prefix: "1. **",
            suffix: "** Raw HTML in the source",
        },
        comments: [
            {
                id: "t-arch-10-c1",
                author: FIXTURE_AUTHORS.rosa!,
                bodyMarkdown:
                    "Security review checkpoint. We should also list this in the security audit log per [#11612042 Comment rail jitters on resize](mention://workitem/11612042?type=Bug&state=Active&stateColor=%23cc293d) (wrong link, will refile).",
                createdAt: "2026-05-19T08:00:00.000Z",
            },
            {
                id: "t-arch-10-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Refiled the security audit work item as a child of the umbrella. Will add a row to the security review log this week.",
                createdAt: "2026-05-19T08:18:00.000Z",
            },
            {
                id: "t-arch-10-c3",
                author: FIXTURE_AUTHORS.rosa!,
                bodyMarkdown: "Thanks. Approving.",
                createdAt: "2026-05-19T08:20:00.000Z",
                reactions: [like("u-shubhd")],
            },
        ],
    },
    {
        id: "t-arch-11",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: "WCAG 2.2 AA",
            prefix: "EMR aims at **",
            suffix: "** for its own",
        },
        comments: [
            {
                id: "t-arch-11-c1",
                author: FIXTURE_AUTHORS.jamie!,
                bodyMarkdown:
                    "Curious why we target 2.2 and not 2.1 — most internal guidelines are still on 2.1. Is the upgrade meaningful for us?",
                createdAt: "2026-05-18T17:00:00.000Z",
            },
            {
                id: "t-arch-11-c2",
                author: FIXTURE_AUTHORS.lila!,
                bodyMarkdown:
                    "2.2 adds focus-not-obscured (minimum) and target-size (minimum), which both apply to the comment rail. Worth doing once.",
                createdAt: "2026-05-18T17:14:00.000Z",
                reactions: [like("u-shubhd", "u-priya")],
            },
        ],
    },
    {
        id: "t-arch-12",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: 'Should we offer a "preview" tab on the diff view',
            prefix: "1. **",
            suffix: " instead of a",
        },
        comments: [
            {
                id: "t-arch-12-c1",
                author: FIXTURE_AUTHORS.morgan!,
                bodyMarkdown:
                    "Strong opinion: no.\n\n1. The diff toolbar is already cramped.\n2. We'd lose the 100%-width article surface.\n3. The current tab is discoverable enough — we measured 73% click-through in the dogfood org.",
                createdAt: "2026-05-19T14:00:00.000Z",
                reactions: [like("u-shubhd", "u-alex", "u-priya")],
            },
            {
                id: "t-arch-12-c2",
                author: FIXTURE_AUTHORS.kenji!,
                bodyMarkdown:
                    "Counterpoint: the *non-Markdown* PRs are the ones we lose discoverability on. Users coming from a non-Markdown PR don't notice the tab exists.",
                createdAt: "2026-05-19T14:10:00.000Z",
            },
            {
                id: "t-arch-12-c3",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Tracked as a separate problem. Tab discovery is its own UX project; let's not fix it by colonising the diff view.",
                createdAt: "2026-05-19T14:20:00.000Z",
                reactions: [like("u-morgan", "u-priya")],
            },
        ],
    },
    {
        id: "t-arch-13",
        filePath: "/docs/architecture.md",
        status: "closed",
        anchor: {
            exact: "Should we support comments on images?",
            prefix: "3. **",
            suffix: "** GFM allows them",
        },
        comments: [
            {
                id: "t-arch-13-c1",
                author: FIXTURE_AUTHORS.priya!,
                bodyMarkdown: "Out of scope for v1. Filed as a future work item.",
                createdAt: "2026-05-12T09:00:00.000Z",
            },
        ],
    },
    {
        id: "t-arch-14",
        filePath: "/docs/architecture.md",
        status: "active",
        anchor: {
            exact: 'Should we provide a "summarise this thread" AI affordance?',
            prefix: "5. **",
            suffix: "**",
        },
        comments: [
            {
                id: "t-arch-14-c1",
                author: FIXTURE_AUTHORS.sven!,
                bodyMarkdown:
                    "Could we use the LLM that ships with the Azure DevOps Copilot extension? No new backend.",
                createdAt: "2026-05-19T13:00:00.000Z",
            },
            {
                id: "t-arch-14-c2",
                author: FIXTURE_AUTHORS.shubhd!,
                bodyMarkdown:
                    "Maybe — but it would lock us to that extension's lifetime. I'd want a fallback for users without it before we ship.\n\nDeferring to iteration 5 conversations.",
                createdAt: "2026-05-19T13:14:00.000Z",
            },
        ],
    },
];
