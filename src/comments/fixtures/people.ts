// Fixture people, work items and pull requests for the standalone dev preview.

import type { CommentAuthor, Reaction } from "../../types";
import type { PullRequestSuggestion, WorkItemSuggestion } from "../mentions";

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

export const FIXTURE_WORK_ITEMS: WorkItemSuggestion[] = [
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

export const FIXTURE_PULL_REQUESTS: PullRequestSuggestion[] = [
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

/** Look up a fixture author by id (falls back to the id as the name). */
const _authorById = new Map(
  Object.values(FIXTURE_AUTHORS).map((a) => [a.id, a] as const),
);

/** Build a "like" reaction from a list of fixture author ids. */
export function like(...ids: string[]): Reaction {
  return {
    kind: "like",
    users: ids.map((id) => ({
      id,
      displayName: _authorById.get(id)?.displayName ?? id,
    })),
  };
}
