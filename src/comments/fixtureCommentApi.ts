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
import { FIXTURE_AUTHORS } from "./fixtures";
import {
  authorToUserSuggestion,
  type PullRequestSuggestion,
  type UserSuggestion,
  type WorkItemSuggestion,
} from "./mentions";

// These mirror the shape of what ADO returns from its identity / WIT / git
// endpoints so the picker UI can be developed against realistic data without
// spinning up a real PR.
const FIXTURE_WORK_ITEMS: WorkItemSuggestion[] = [
  {
    kind: "workitem",
    id: "11612051",
    workItemType: "Scenario",
    title: "App caching scenarios",
    state: "In Progress",
    stateColor: "#cc6d00",
  },
  {
    kind: "workitem",
    id: "11612042",
    workItemType: "Bug",
    title: "Comment rail jitters on resize",
    state: "Active",
    stateColor: "#cc293d",
  },
  {
    kind: "workitem",
    id: "11611998",
    workItemType: "Task",
    title: "Wire up identity picker SDK service",
    state: "To Do",
    stateColor: "#b2b2b2",
  },
  {
    kind: "workitem",
    id: "11611820",
    workItemType: "User Story",
    title: "Reviewer can @mention teammates in a comment",
    state: "Resolved",
    stateColor: "#339933",
  },
  {
    kind: "workitem",
    id: "11611702",
    workItemType: "Feature",
    title: "Inline image attachments on PR comments",
    state: "In Progress",
    stateColor: "#cc6d00",
  },
];

const FIXTURE_PULL_REQUESTS: PullRequestSuggestion[] = [
  {
    kind: "pullrequest",
    id: "5058833",
    title:
      "[Grid] Implement add task in plan and myday, mytasks views using dom-based AddTaskRow instead of canvas",
    status: "active",
    repository: "OneTodo",
  },
  {
    kind: "pullrequest",
    id: "5058641",
    title: "[Comments] Surface unresolved threads in the file tree",
    status: "completed",
    repository: "OneTodo",
  },
  {
    kind: "pullrequest",
    id: "5057914",
    title: "Bump @azure/identity to 4.4.1",
    status: "completed",
    repository: "OneTodo",
  },
  {
    kind: "pullrequest",
    id: "5057120",
    title: "Spike: replace markdown-it with unified pipeline",
    status: "abandoned",
    repository: "OneTodo",
  },
];

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
