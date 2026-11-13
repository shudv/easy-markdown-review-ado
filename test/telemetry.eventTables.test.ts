// Tests for thematic-table routing (src/telemetry/eventTables.ts): every event
// lands in Engagement or Diagnostics with its name in a `name` column.

import { describe, expect, it } from "vitest";

import { EVENT } from "../src/telemetry/events";
import { TELEMETRY_TABLE, tableFor, toTableEvent } from "../src/telemetry/eventTables";

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
    EVENT.MathSourceViewed,
    EVENT.MathSourceCopied,
    EVENT.LinkCopied,
    EVENT.LinkOpened,
    EVENT.UpdatesCompared,
    EVENT.MinimapUsed,
    EVENT.PanelToggled,
    EVENT.ReaderPrefChanged,
    EVENT.DocumentsHubOpened,
];

const DIAGNOSTIC_EVENTS = [
    EVENT.AppLoaded,
    EVENT.AuthFailure,
    EVENT.AuthSessionRefresh,
    EVENT.AuthHeldWrite,
    EVENT.DiagramRenderIssue,
    EVENT.DocumentFeatures,
    EVENT.ThreadsSnapshot,
    EVENT.AppException,
];

describe("tableFor", () => {
    it.each(ENGAGEMENT_EVENTS)("routes %s to Engagement", (name) => {
        expect(tableFor(name)).toBe(TELEMETRY_TABLE.Engagement);
    });

    it.each(DIAGNOSTIC_EVENTS)("routes %s to Diagnostics", (name) => {
        expect(tableFor(name)).toBe(TELEMETRY_TABLE.Diagnostics);
    });

    it("defaults an unknown/new event to Diagnostics", () => {
        // Engagement only takes listed user actions, so an event nobody
        // classified can never pollute the product table.
        expect(tableFor("something.new")).toBe(TELEMETRY_TABLE.Diagnostics);
    });

    // A new event must be given an expected table here, so its routing is a
    // deliberate decision rather than whatever the default happens to be.
    it.each(Object.values(EVENT))("has an expected table for %s", (name) => {
        expect([...ENGAGEMENT_EVENTS, ...DIAGNOSTIC_EVENTS]).toContain(name);
    });
});

describe("toTableEvent", () => {
    const data = { anchorKind: "line", bodyLength: 12, projectId: "p1" };

    it("emits once, to the thematic table, with the event name in a `name` column", () => {
        expect(toTableEvent(EVENT.CommentCreated, data)).toEqual({
            name: TELEMETRY_TABLE.Engagement,
            data: { ...data, name: "comment.created" },
        });
    });

    it("routes a diagnostics event to the Diagnostics table", () => {
        expect(toTableEvent(EVENT.AuthFailure, data)).toEqual({
            name: TELEMETRY_TABLE.Diagnostics,
            data: { ...data, name: "auth.failure" },
        });
    });

    it("makes the `name` discriminator authoritative (a stray property cannot clobber it)", () => {
        const withStrayName = { ...data, name: "attacker.controlled" };
        expect(toTableEvent(EVENT.FileOpened, withStrayName).data.name).toBe("file.opened");
    });

    it("leaves the caller's data untouched", () => {
        toTableEvent(EVENT.RepoSwitched, data);

        expect(data).not.toHaveProperty("name");
    });

    it.each(Object.values(EVENT))("never emits %s to a per-event table", (name) => {
        expect(Object.values(TELEMETRY_TABLE)).toContain(toTableEvent(name, data).name);
    });
});
