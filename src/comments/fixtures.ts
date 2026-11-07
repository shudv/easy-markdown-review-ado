// Fixture comment threads for the standalone dev preview.
//
// The exact / prefix / suffix strings here are copied verbatim from the
// fixture Markdown files so the anchor resolver lights them up immediately
// on load. If you change a fixture .md, you may need to re-pick excerpts.

import type { CommentThread } from "../types";
import { ARCHITECTURE_THREADS } from "./fixtures/architectureThreads";
import {
    API_REFERENCE_THREADS,
    DESIGN_THREADS,
    MORE_DESIGN_THREADS,
    ORPHAN_THREADS,
    RELEASE_NOTES_THREADS,
} from "./fixtures/docThreads";
import { SPEC_RFC_THREADS } from "./fixtures/specRfcThreads";

export { FIXTURE_AUTHORS, FIXTURE_PULL_REQUESTS, FIXTURE_WORK_ITEMS } from "./fixtures/people";

/** Current PR threads — i.e. threads created in the open PR. */
export const FIXTURE_CURRENT_THREADS: CommentThread[] = [
    ...DESIGN_THREADS,
    ...ARCHITECTURE_THREADS,
    ...API_REFERENCE_THREADS,
    ...SPEC_RFC_THREADS,
    ...RELEASE_NOTES_THREADS,
    ...MORE_DESIGN_THREADS,
];

/** A thread whose anchor no longer matches — exercises the "orphaned" UI. */
export const FIXTURE_ORPHAN_THREADS: CommentThread[] = ORPHAN_THREADS;

export const ALL_FIXTURE_THREADS: CommentThread[] = [
    ...FIXTURE_CURRENT_THREADS,
    ...FIXTURE_ORPHAN_THREADS,
];
