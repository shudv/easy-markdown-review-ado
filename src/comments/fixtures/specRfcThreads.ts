// Fixture comment threads for the standalone dev preview — spec-rfc.md.
// Excerpts are copied verbatim from the fixture Markdown files (see
// ../fixtures.ts).

import type { CommentThread } from "../../types";
import { FIXTURE_AUTHORS, like } from "./people";

// ---- spec-rfc.md: long-form discussion threads ------------------------
export const SPEC_RFC_THREADS: CommentThread[] = [
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
];
