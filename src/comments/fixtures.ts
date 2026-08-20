// Fixture comment threads for the standalone dev preview.
//
// The exact / prefix / suffix strings here are copied verbatim from the
// fixture Markdown files so the anchor resolver lights them up immediately
// on load. If you change a fixture .md, you may need to re-pick excerpts.

import type { CommentAuthor, CommentThread, Reaction } from "../types";

export const FIXTURE_AUTHORS: Record<string, CommentAuthor> = {
  shubhd: {
    id: "u-shubhd",
    displayName: "Shubham Dwivedi",
    initials: "SD",
  },
  alex: {
    id: "u-alex",
    displayName: "Alex Rivera",
    initials: "AR",
  },
  jamie: {
    id: "u-jamie",
    displayName: "Jamie Chen",
    initials: "JC",
  },
  priya: {
    id: "u-priya",
    displayName: "Priya Nair",
    initials: "PN",
  },
  morgan: {
    id: "u-morgan",
    displayName: "Morgan Patel",
    initials: "MP",
  },
  kenji: {
    id: "u-kenji",
    displayName: "Kenji Tanaka",
    initials: "KT",
  },
  lila: {
    id: "u-lila",
    displayName: "Lila Osman",
    initials: "LO",
  },
  sven: {
    id: "u-sven",
    displayName: "Sven Eriksson",
    initials: "SE",
  },
  rosa: {
    id: "u-rosa",
    displayName: "Rosa Delgado",
    initials: "RD",
  },
  bot: {
    id: "u-bot",
    displayName: "Markdown Review Bot",
    initials: "MB",
  },
};

/** Look up a fixture author by id (falls back to the id as the name). */
const _authorById = new Map(
  Object.values(FIXTURE_AUTHORS).map((a) => [a.id, a] as const),
);

/** Build a "like" reaction from a list of fixture author ids. */
function like(...ids: string[]): Reaction {
  return {
    kind: "like",
    users: ids.map((id) => ({
      id,
      displayName: _authorById.get(id)?.displayName ?? id,
    })),
  };
}

/** Current PR threads — i.e. threads created in the open PR. */
export const FIXTURE_CURRENT_THREADS: CommentThread[] = [
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
        bodyMarkdown:
          "Should we use hypothes.is's selector library, or write our own?",
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

  // ---- architecture.md: long, mention-heavy, multi-author threads -------

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

  // ---- api-reference.md: short, technical threads -----------------------

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
      prefix:
        "Sync variant for short bodies (e.g. comment bodies). Significantly\nslower per byte than the async version because it ",
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
      exact:
        "the type is a string union with one\nmember so the surrounding code can grow without churn",
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
      prefix:
        "- `CommentThread.status` ↔ `GitPullRequestCommentThread.status`.\n  ",
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

  // ---- spec-rfc.md: long-form discussion threads ------------------------

  {
    id: "t-rfc-1",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "I've reviewed this doc three times",
      prefix: '> "',
      suffix: ". Every time",
    },
    comments: [
      {
        id: "t-rfc-1-c1",
        author: FIXTURE_AUTHORS.morgan!,
        bodyMarkdown:
          "This quote is going on the team wall. Beautiful pain point.",
        createdAt: "2026-05-19T10:00:00.000Z",
        reactions: [
          like(
            "u-shubhd",
            "u-alex",
            "u-priya",
            "u-jamie",
            "u-sven",
            "u-lila",
            "u-kenji",
            "u-rosa",
            "u-bot",
          ),
        ],
      },
      {
        id: "t-rfc-1-c2",
        author: FIXTURE_AUTHORS.priya!,
        bodyMarkdown: "Should we credit the reviewer? They gave us permission.",
        createdAt: "2026-05-19T10:14:00.000Z",
      },
      {
        id: "t-rfc-1-c3",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          "Privacy-by-default — leaving it anonymous. We can revisit when the RFC ships.",
        createdAt: "2026-05-19T10:18:00.000Z",
      },
    ],
  },
  {
    id: "t-rfc-2",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "~500 historical threads per file",
      prefix: "The system must scale to ",
      suffix: " without",
    },
    comments: [
      {
        id: "t-rfc-2-c1",
        author: FIXTURE_AUTHORS.kenji!,
        bodyMarkdown:
          "Is 500 realistic? The biggest design doc in our org has ~120 threads across its whole history.",
        createdAt: "2026-05-18T11:00:00.000Z",
      },
      {
        id: "t-rfc-2-c2",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          "Long-tail estimate. The OS team's `KERNEL_DESIGN.md` has 487 historical threads. We sized for the 95th percentile of org-wide design docs.",
        createdAt: "2026-05-18T11:14:00.000Z",
        reactions: [like("u-priya", "u-morgan")],
      },
      {
        id: "t-rfc-2-c3",
        author: FIXTURE_AUTHORS.kenji!,
        bodyMarkdown: "Accepting.",
        createdAt: "2026-05-18T11:18:00.000Z",
      },
    ],
  },
  {
    id: "t-rfc-3",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "the worst case is ~50 ADO API\ncalls per file load",
      prefix: "**API cost.** Discovery is expensive; ",
      suffix: ". We mitigate",
    },
    comments: [
      {
        id: "t-rfc-3-c1",
        author: FIXTURE_AUTHORS.rosa!,
        bodyMarkdown:
          "50 calls is going to trip the ADO rate limiter on dogfood orgs. Have we talked to the ADO platform team?",
        createdAt: "2026-05-17T09:00:00.000Z",
      },
      {
        id: "t-rfc-3-c2",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          'Yes — they pointed us at the bulk threads endpoint we\'re not using yet. It drops the worst case to ~5 calls. Filed [#11611820 Reviewer can @mention teammates in a comment](mention://workitem/11611820?type=User+Story&state=Resolved&stateColor=%23339933) as the umbrella, will refile under "Adopt bulk threads endpoint".',
        createdAt: "2026-05-17T09:30:00.000Z",
        reactions: [like("u-rosa", "u-alex")],
      },
      {
        id: "t-rfc-3-c3",
        author: FIXTURE_AUTHORS.rosa!,
        bodyMarkdown:
          "Once you have the work item, ping me and I'll add it to next sprint's planning.",
        createdAt: "2026-05-17T09:34:00.000Z",
      },
    ],
  },
  {
    id: "t-rfc-4",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "Background discovery service.",
      prefix: "**",
      suffix: " A small backend",
    },
    comments: [
      {
        id: "t-rfc-4-c1",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          "The single most important sentence in this RFC. No backend = no oncall = small team can ship.",
        createdAt: "2026-05-15T13:00:00.000Z",
        reactions: [
          like("u-priya", "u-morgan", "u-kenji", "u-alex", "u-lila", "u-sven"),
        ],
      },
    ],
  },
  {
    id: "t-rfc-5",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact:
        "Defaulting to opt-in is friendlier; opt-out makes the feature\n   discoverable",
      prefix: "opt-in or opt-out?\n>    ",
      suffix: ". The team is split",
    },
    comments: [
      {
        id: "t-rfc-5-c1",
        author: FIXTURE_AUTHORS.alex!,
        bodyMarkdown:
          "Opt-out for the win. Discoverability is the whole point — a feature that nobody finds doesn't exist.",
        createdAt: "2026-05-18T10:00:00.000Z",
        reactions: [like("u-morgan")],
      },
      {
        id: "t-rfc-5-c2",
        author: FIXTURE_AUTHORS.priya!,
        bodyMarkdown:
          'Hard disagree. Notifications are the #1 driver of "extension uninstall" complaints in the dogfood survey. Opt-in respects the user.',
        createdAt: "2026-05-18T10:10:00.000Z",
        reactions: [like("u-jamie", "u-rosa", "u-lila")],
      },
      {
        id: "t-rfc-5-c3",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          'Compromise: opt-in by default, with a one-time toast on first historical thread that says "You can turn this on in settings". Best of both?',
        createdAt: "2026-05-18T10:30:00.000Z",
      },
      {
        id: "t-rfc-5-c4",
        author: FIXTURE_AUTHORS.alex!,
        bodyMarkdown: "I can live with that. Let's ship it.",
        createdAt: "2026-05-18T10:32:00.000Z",
        reactions: [like("u-shubhd", "u-priya")],
      },
      {
        id: "t-rfc-5-c5",
        author: FIXTURE_AUTHORS.priya!,
        bodyMarkdown: "👍",
        createdAt: "2026-05-18T10:33:00.000Z",
      },
    ],
  },
  {
    id: "t-rfc-6",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "this PR only",
      prefix: "- **",
      suffix: "**:",
    },
    comments: [
      {
        id: "t-rfc-6-c1",
        author: FIXTURE_AUTHORS.morgan!,
        bodyMarkdown:
          'Should the default be "this PR only" or "all"? I keep flipping on what feels right.',
        createdAt: "2026-05-19T07:30:00.000Z",
      },
      {
        id: "t-rfc-6-c2",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown:
          '"This PR only" — the dogfood feedback was overwhelming. People want to focus on their PR first, then optionally browse history.',
        createdAt: "2026-05-19T07:40:00.000Z",
        reactions: [like("u-morgan", "u-priya")],
      },
    ],
  },
  {
    id: "t-rfc-7",
    filePath: "/docs/spec-rfc.md",
    status: "wontFix",
    anchor: {
      exact: "Per-paragraph history popover.",
      prefix: "1. **",
      suffix: " Click a paragraph",
    },
    comments: [
      {
        id: "t-rfc-7-c1",
        author: FIXTURE_AUTHORS.kenji!,
        bodyMarkdown:
          "We genuinely tried this for a week. Paragraph identity is a swamp — split a paragraph in two and now you have two anchors pointing at one paragraph, or one anchor pointing at no paragraph.",
        createdAt: "2026-04-22T15:00:00.000Z",
      },
      {
        id: "t-rfc-7-c2",
        author: FIXTURE_AUTHORS.shubhd!,
        bodyMarkdown: "Closing as won't-fix. Reasoning above.",
        createdAt: "2026-04-22T15:18:00.000Z",
      },
    ],
  },
  {
    id: "t-rfc-8",
    filePath: "/docs/spec-rfc.md",
    status: "active",
    anchor: {
      exact: "the data model unstable",
      prefix: "paragraphs split and merge,\n   making ",
      suffix: ".",
    },
    comments: [
      {
        id: "t-rfc-8-c1",
        author: FIXTURE_AUTHORS.lila!,
        bodyMarkdown:
          "Have we benchmarked the **merge** case? My intuition says splits are common and merges are rare.",
        createdAt: "2026-05-18T19:00:00.000Z",
      },
      {
        id: "t-rfc-8-c2",
        author: FIXTURE_AUTHORS.kenji!,
        bodyMarkdown:
          "Sampled 1,000 commits across `docs/`. Splits: 71. Merges: 12. Renames-with-rewrite: 240 (the long tail).",
        createdAt: "2026-05-18T19:14:00.000Z",
        reactions: [like("u-lila", "u-shubhd")],
      },
    ],
  },

  // ---- /RELEASE_NOTES.md: short threads ---------------------------------

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
        bodyMarkdown:
          "Should we list each chip on a sub-bullet? One line gets dense.",
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

  // ---- additional design.md threads -------------------------------------

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
export const FIXTURE_ORPHAN_THREADS: CommentThread[] = [
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

export const ALL_FIXTURE_THREADS: CommentThread[] = [
  ...FIXTURE_CURRENT_THREADS,
  ...FIXTURE_ORPHAN_THREADS,
];
