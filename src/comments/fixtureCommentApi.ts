// Fixture-backed CommentApi for the standalone dev preview and Storybook.
//
// `LocalOnlyCommentApi` (in ./api) is the *production* fallback used when no
// real ADO-backed CommentApi is supplied (e.g. the Documents hub's transparent
// per-document mode before a per-path API resolves). It must NOT surface sample
// people / work items / PRs, so its search methods return empty. This subclass
// layers the fixture data back on for dev/stories only — because nothing in the
// production entry points imports it, the fixtures below (and FIXTURE_AUTHORS)
// tree-shake out of the shipped bundles.

import { LocalOnlyCommentApi, filterByQuery } from "./api";
import {
  FIXTURE_AUTHORS,
  FIXTURE_PULL_REQUESTS,
  FIXTURE_WORK_ITEMS,
} from "./fixtures";
import {
  authorToUserSuggestion,
  type PullRequestSuggestion,
  type UserSuggestion,
  type WorkItemSuggestion,
} from "./mentions";

/**
 * `LocalOnlyCommentApi` plus fixture-backed mention search. Used only by the
 * standalone preview and Storybook so the picker UI has realistic data.
 */
export class FixtureCommentApi extends LocalOnlyCommentApi {
  override async searchUsers(query: string): Promise<UserSuggestion[]> {
    const all = Object.values(FIXTURE_AUTHORS).map(authorToUserSuggestion);
    return filterByQuery(all, query, (u) => [u.displayName, u.id, u.initials]);
  }

  override async searchWorkItems(query: string): Promise<WorkItemSuggestion[]> {
    return filterByQuery(FIXTURE_WORK_ITEMS, query, (w) => [
      w.id,
      w.title,
      w.workItemType,
      w.state,
    ]);
  }

  override async searchPullRequests(
    query: string,
  ): Promise<PullRequestSuggestion[]> {
    return filterByQuery(FIXTURE_PULL_REQUESTS, query, (p) => [
      p.id,
      p.title,
      p.repository!,
    ]);
  }

  override async resolveIdentities(
    ids: string[],
  ): Promise<Record<string, { displayName: string; avatarUrl?: string }>> {
    const out: Record<string, { displayName: string; avatarUrl?: string }> = {};
    for (const a of Object.values(FIXTURE_AUTHORS)) {
      if (ids.some((id) => id.toLowerCase() === a.id.toLowerCase())) {
        out[a.id] = { displayName: a.displayName, avatarUrl: a.avatarUrl };
      }
    }
    return out;
  }
}
