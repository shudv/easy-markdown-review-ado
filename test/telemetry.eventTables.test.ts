// Tests for thematic-table routing (src/telemetry/eventTables.ts) — the mapping
// that collapses per-event tables into Engagement/Diagnostics, and the
// dual-emission plan used during the legacy → thematic migration window.

import { describe, expect, it } from "vitest";

import { EVENT } from "../src/telemetry/events";
import {
  TELEMETRY_TABLE,
  tableFor,
  toTableEvents,
} from "../src/telemetry/eventTables";

const ENGAGEMENT_EVENTS = [
  EVENT.CommentCreated,
  EVENT.CommentReplied,
  EVENT.CommentEdited,
  EVENT.CommentDeleted,
  EVENT.ThreadResolved,
  EVENT.ThreadReopened,
  EVENT.ThreadDeleted,
  EVENT.FileOpened,
  EVENT.RepoSwitched,
  EVENT.SearchPerformed,
  EVENT.CommentReacted,
  EVENT.CommentFiltered,
  EVENT.ThreadMarkedPending,
  EVENT.ThreadClosed,
  EVENT.DiffToggled,
  EVENT.CommentNavigated,
  EVENT.CommentsRefreshed,
  EVENT.MermaidSourceViewed,
  EVENT.MermaidSourceCopied,
];

// Events added *after* the thematic migration — thematic-only, no legacy table.
const POST_MIGRATION_EVENTS = [
  EVENT.CommentReacted,
  EVENT.CommentFiltered,
  EVENT.ThreadMarkedPending,
  EVENT.ThreadClosed,
  EVENT.DiffToggled,
  EVENT.CommentNavigated,
  EVENT.CommentsRefreshed,
  EVENT.MermaidSourceViewed,
  EVENT.MermaidSourceCopied,
];

const DIAGNOSTIC_EVENTS = [
  EVENT.AppLoaded,
  EVENT.AuthFailure,
  EVENT.AppException,
];

describe("tableFor", () => {
  it.each(ENGAGEMENT_EVENTS)("routes %s to Engagement", (name) => {
    expect(tableFor(name)).toBe(TELEMETRY_TABLE.Engagement);
  });

  it.each(DIAGNOSTIC_EVENTS)("routes %s to Diagnostics", (name) => {
    expect(tableFor(name)).toBe(TELEMETRY_TABLE.Diagnostics);
  });

  it("defaults an unknown/new event to Engagement", () => {
    // New user-action events should route to Engagement without needing to be
    // registered; only diagnostics are listed explicitly.
    expect(tableFor("something.new")).toBe(TELEMETRY_TABLE.Engagement);
  });

  it("covers every event in the catalog", () => {
    // Guard against an event being added to EVENT but forgotten here.
    const classified = new Set([...ENGAGEMENT_EVENTS, ...DIAGNOSTIC_EVENTS]);
    for (const name of Object.values(EVENT)) {
      expect(classified.has(name)).toBe(true);
      expect(Object.values(TELEMETRY_TABLE)).toContain(tableFor(name));
    }
  });
});

describe("toTableEvents", () => {
  const data = { anchorKind: "line", bodyLength: 12, projectId: "p1" };

  it("dual-emits BOTH the legacy per-event table and the thematic table", () => {
    const emissions = toTableEvents(EVENT.CommentCreated, data);
    expect(emissions).toHaveLength(2);

    const [legacy, thematic] = emissions;
    // Legacy: the event name IS the table; data is untouched (no discriminator).
    expect(legacy).toEqual({ name: "comment.created", data });
    expect(legacy!.data).not.toHaveProperty("name");
    // Thematic: theme is the table; original name moves into a `name` column.
    expect(thematic).toEqual({
      name: TELEMETRY_TABLE.Engagement,
      data: { ...data, name: "comment.created" },
    });
  });

  it("routes a diagnostics event's thematic emission to the Diagnostics table", () => {
    const [, thematic] = toTableEvents(EVENT.AuthFailure, data);
    expect(thematic).toEqual({
      name: TELEMETRY_TABLE.Diagnostics,
      data: { ...data, name: "auth.failure" },
    });
  });

  it("routes exceptions to the Diagnostics table under the app.exception name", () => {
    const [, thematic] = toTableEvents(EVENT.AppException, data);
    expect(thematic).toMatchObject({
      name: TELEMETRY_TABLE.Diagnostics,
      data: { name: "app.exception" },
    });
  });

  it("makes the `name` discriminator authoritative (a stray property cannot clobber it)", () => {
    const withStrayName = { ...data, name: "attacker.controlled" };
    const [, thematic] = toTableEvents(EVENT.FileOpened, withStrayName);
    expect(thematic!.data.name).toBe("file.opened");
  });

  it("copies data so neither emission shares a reference with the input", () => {
    const [legacy, thematic] = toTableEvents(EVENT.RepoSwitched, data);
    expect(legacy!.data).not.toBe(data);
    expect(thematic!.data).not.toBe(data);
    expect(legacy!.data).toEqual(data);
  });

  it.each(POST_MIGRATION_EVENTS)(
    "emits ONLY the thematic table for %s (no new legacy table)",
    (name) => {
      const emissions = toTableEvents(name, data);
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toEqual({
        name: TELEMETRY_TABLE.Engagement,
        data: { ...data, name },
      });
    },
  );

  it.each([
    EVENT.CommentCreated,
    EVENT.AppLoaded,
    EVENT.AuthFailure,
    EVENT.AppException,
  ])("still dual-emits the pre-migration event %s", (name) => {
    expect(toTableEvents(name, data)).toHaveLength(2);
  });
});
