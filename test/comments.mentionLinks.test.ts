// Tests for the mention-link hydrator. The hydrator is a pure DOM
// function — it scans for `<a class="emr-mention" data-mention-kind="…">`
// anchors carrying `mention://` placeholder hrefs and rewrites them to
// real ADO web URLs using the supplied context. These tests exercise
// every branch of `hydrateMentionLinks` + `buildMentionWebUrl` via the
// public API.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  hydrateMentionLinks,
  type MentionLinkResolution,
} from "../src/comments/mentionLinks";

const CTX: MentionLinkResolution = {
  orgUrl: "https://dev.azure.com/contoso",
  projectName: "Awesome Project",
  defaultRepoName: "main-repo",
};

function mountHtml(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hydrateMentionLinks — no-op guards", () => {
  it("does nothing when root is null", () => {
    expect(() => hydrateMentionLinks(null, CTX)).not.toThrow();
  });

  it("does nothing when ctx is null", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42" href="mention://workitem/42">#42</a>',
    );
    hydrateMentionLinks(root, null);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "mention://workitem/42",
    );
  });

  it("leaves anchors that already point at an https URL alone", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42" href="https://example.com/already">#42</a>',
    );
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "https://example.com/already",
    );
  });

  it("leaves anchors with http:// hrefs alone too", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="9" href="http://legacy.example/9">!9</a>',
    );
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "http://legacy.example/9",
    );
  });

  it("ignores anchors without our kind data attr", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="user" data-mention-id="alice" href="mention://user/alice">@alice</a>',
    );
    hydrateMentionLinks(root, CTX);
    // User mentions are not on the query selector — href is unchanged.
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "mention://user/alice",
    );
  });

  it("skips anchors whose href fails parseMentionUrl", () => {
    // The DOM walker uses the data-mention-kind selector, but the href
    // itself may be corrupt; parseMentionUrl returns null and the
    // walker bails on that anchor.
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42" href="not-a-mention-url">#42</a>',
    );
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "not-a-mention-url",
    );
  });

  it("handles an empty href without throwing", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42">#42</a>',
    );
    expect(() => hydrateMentionLinks(root, CTX)).not.toThrow();
  });
});

describe("hydrateMentionLinks — workitem rewrites", () => {
  it("rewrites a workitem mention into the canonical ADO URL", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42" href="mention://workitem/42">#42</a>',
    );
    hydrateMentionLinks(root, CTX);
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_workitems/edit/42",
    );
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("trims a trailing slash from orgUrl so the result is canonical", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="7" href="mention://workitem/7">#7</a>',
    );
    hydrateMentionLinks(root, {
      orgUrl: "https://dev.azure.com/contoso///",
      projectName: "P",
    });
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/P/_workitems/edit/7",
    );
  });
});

describe("hydrateMentionLinks — pullrequest rewrites", () => {
  it("uses repo from URL params when present", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="100" href="mention://pullrequest/100?repo=widgets&status=active">!100</a>',
    );
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_git/widgets/pullrequest/100",
    );
  });

  it("falls back to defaultRepoName from ctx when the URL omits repo", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="50" href="mention://pullrequest/50">!50</a>',
    );
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_git/main-repo/pullrequest/50",
    );
  });

  it("leaves the placeholder href when neither repo source resolves", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="50" href="mention://pullrequest/50">!50</a>',
    );
    hydrateMentionLinks(root, {
      orgUrl: "https://dev.azure.com/contoso",
      projectName: "P",
      // No defaultRepoName, no repo in URL → cannot construct a link.
    });
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("mention://pullrequest/50");
    expect(a.getAttribute("target")).toBeNull();
  });

  it("encodes a repo name containing spaces / special chars", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="3" href="mention://pullrequest/3?repo=Repo%20With%20Spaces">!3</a>',
    );
    hydrateMentionLinks(root, CTX);
    // URLSearchParams decodes the param to "Repo With Spaces"; the
    // hydrator re-encodes via encodeURIComponent.
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_git/Repo%20With%20Spaces/pullrequest/3",
    );
  });
});

describe("hydrateMentionLinks — bulk + idempotency", () => {
  it("rewrites multiple mentions in one walk", () => {
    const root = mountHtml(
      [
        "<p>Hello ",
        '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="1" href="mention://workitem/1">#1</a>',
        " and ",
        '<a class="emr-mention" data-mention-kind="pullrequest" data-mention-id="9" href="mention://pullrequest/9?repo=alpha">!9</a>',
        "</p>",
      ].join(""),
    );
    hydrateMentionLinks(root, CTX);
    const anchors = root.querySelectorAll("a");
    expect(anchors[0]!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_workitems/edit/1",
    );
    expect(anchors[1]!.getAttribute("href")).toBe(
      "https://dev.azure.com/contoso/Awesome%20Project/_git/alpha/pullrequest/9",
    );
  });

  it("is idempotent — a second pass is a no-op", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="42" href="mention://workitem/42">#42</a>',
    );
    hydrateMentionLinks(root, CTX);
    const firstHref = root.querySelector("a")!.getAttribute("href");
    hydrateMentionLinks(root, CTX);
    expect(root.querySelector("a")!.getAttribute("href")).toBe(firstHref);
  });
});

describe("hydrateMentionLinks — orgUrl scheme validation", () => {
  it("refuses to build a link when orgUrl has a dangerous scheme", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="1" href="mention://workitem/1">#1</a>',
    );
    hydrateMentionLinks(root, {
      orgUrl: "javascript:alert(1)",
      projectName: "P",
    });
    // The placeholder stays; nothing navigable is produced.
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "mention://workitem/1",
    );
    expect(root.querySelector("a")!.getAttribute("target")).toBeNull();
  });

  it("refuses to build a link when orgUrl is not a valid URL", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="1" href="mention://workitem/1">#1</a>',
    );
    hydrateMentionLinks(root, { orgUrl: "not a url", projectName: "P" });
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "mention://workitem/1",
    );
  });

  it("refuses other non-http(s) schemes (data:, file:, ftp:)", () => {
    for (const orgUrl of [
      "data:text/plain,hi",
      "file:///C:/Windows",
      "ftp://ftp.example.com/path",
    ]) {
      const root = mountHtml(
        '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="1" href="mention://workitem/1">#1</a>',
      );
      hydrateMentionLinks(root, { orgUrl, projectName: "P" });
      expect(root.querySelector("a")!.getAttribute("href")).toBe(
        "mention://workitem/1",
      );
    }
  });

  it("accepts http:// orgUrls (e.g. on-prem / private deployments)", () => {
    const root = mountHtml(
      '<a class="emr-mention" data-mention-kind="workitem" data-mention-id="7" href="mention://workitem/7">#7</a>',
    );
    hydrateMentionLinks(root, {
      orgUrl: "http://tfs.contoso.local:8080/tfs/DefaultCollection",
      projectName: "P",
    });
    expect(root.querySelector("a")!.getAttribute("href")).toBe(
      "http://tfs.contoso.local:8080/tfs/DefaultCollection/P/_workitems/edit/7",
    );
  });
});
