import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  summariseTrackerCommit,
  type TrackerFileChange,
  type TrackerReader,
  trackerReads,
} from "../src/core/activity.ts";

const NAV = ".navbook";
const OPEN = `${NAV}/issues/open/bqlybac0-login-timeout`;
const CLOSED = `${NAV}/issues/closed/bqlybac0-login-timeout`;
const PR = `${NAV}/prs/open/dk3mp2x9-raise-the-deadline`;

function issue(extra = "", body = "Aborts after 5 s on 3G.\n"): string {
  return `---\ntitle: Login times out\nauthor: A <a@example.invalid>\ncreated: 2026-08-03T14:12:07Z\nlabels: [bug]\n${extra}---\n\n${body}`;
}

function pr(revisions: number, extra = ""): string {
  const pinned = Array.from(
    { length: revisions },
    (_, i) =>
      `  - head: ${String(i + 1).repeat(40)}\n    base: ${"0".repeat(40)}\n    date: 2026-08-04T10:00:0${i}Z\n`,
  ).join("");
  return `---\ntitle: Raise the deadline\nauthor: A <a@example.invalid>\ncreated: 2026-08-04T10:00:00Z\ntarget: main\nrevisions:\n${pinned}${extra}---\n\nThirty seconds.\n`;
}

/** A reader over `{ "before:<path>": text, "after:<path>": text }`. */
function reader(texts: Record<string, string>): TrackerReader {
  return (side, path) => texts[`${side}:${path}`] ?? null;
}

const file = (
  path: string,
  status: TrackerFileChange["status"],
  oldPath: string | null = null,
): TrackerFileChange => ({ path, oldPath, status });

describe("summariseTrackerCommit", () => {
  it("reads a close: the move, the resolution, and the comments carried along", () => {
    const files = [
      file(`${CLOSED}/issue.md`, "renamed", `${OPEN}/issue.md`),
      file(
        `${CLOSED}/comments/2026-08-03T141207Z-t5kr1gq6.md`,
        "renamed",
        `${OPEN}/comments/2026-08-03T141207Z-t5kr1gq6.md`,
      ),
    ];
    const subject = "docs(issue): close #bqlybac0";
    assert.deepEqual(trackerReads(subject, files, NAV), [
      { side: "before", path: `${OPEN}/issue.md` },
      { side: "after", path: `${CLOSED}/issue.md` },
    ]);
    const summary = summariseTrackerCommit(
      subject,
      files,
      NAV,
      reader({
        [`before:${OPEN}/issue.md`]: issue(),
        [`after:${CLOSED}/issue.md`]: issue("resolution: fixed\n"),
      }),
    );
    assert.deepEqual(summary, {
      verb: "close",
      kind: "issue",
      entity: "bqlybac0",
      title: "Login times out",
      facts: [
        { field: "status", before: "open", after: "closed" },
        { field: "resolution", before: null, after: "fixed" },
        { field: "comments", before: null, after: "1 moved" },
      ],
    });
  });

  it("reads an open: the fields it set, without the ones every record has", () => {
    const summary = summariseTrackerCommit(
      "docs(pr): open #dk3mp2x9",
      [file(`${PR}/pr.md`, "added")],
      NAV,
      reader({ [`after:${PR}/pr.md`]: pr(1, "labels: [bug, auth]\n") }),
    );
    assert.equal(summary?.verb, "open");
    assert.equal(summary?.kind, "pr");
    assert.equal(summary?.title, "Raise the deadline");
    assert.deepEqual(summary?.facts, [
      { field: "target", before: null, after: "main" },
      { field: "labels", before: null, after: "bug, auth" },
      { field: "description", before: null, after: "1 line" },
    ]);
  });

  it("counts revisions, so a new one reads as an update", () => {
    const summary = summariseTrackerCommit(
      "Pin the new head",
      [file(`${PR}/pr.md`, "modified")],
      NAV,
      reader({ [`before:${PR}/pr.md`]: pr(1), [`after:${PR}/pr.md`]: pr(2) }),
    );
    assert.equal(summary?.verb, "update");
    assert.deepEqual(summary?.facts, [{ field: "revisions", before: "1", after: "2" }]);
  });

  it("says a title changed, and an edited description without its text", () => {
    const summary = summariseTrackerCommit(
      "docs(issue): edit #bqlybac0",
      [file(`${OPEN}/issue.md`, "modified")],
      NAV,
      reader({
        [`before:${OPEN}/issue.md`]: issue(),
        [`after:${OPEN}/issue.md`]: issue("", "Aborts after 5 s on 3G and on EDGE.\n").replace(
          "Login times out",
          "Login times out on slow links",
        ),
      }),
    );
    assert.equal(summary?.title, "Login times out on slow links");
    assert.deepEqual(summary?.facts, [
      { field: "title", before: "Login times out", after: "Login times out on slow links" },
      { field: "description", before: null, after: "edited" },
    ]);
  });

  it("reads a review's verdict, and finds the title in the file it left alone", () => {
    const comment = `${PR}/comments/2026-08-04T120000Z-cccc0004.md`;
    const subject = "docs(pr): review #dk3mp2x9";
    const files = [file(comment, "added")];
    assert.deepEqual(trackerReads(subject, files, NAV), [
      { side: "after", path: comment },
      { side: "after", path: `${PR}/pr.md` },
    ]);
    const summary = summariseTrackerCommit(
      subject,
      files,
      NAV,
      reader({
        [`after:${comment}`]: `---\nauthor: B <b@example.invalid>\nverdict: approve\nrevision: ${"1".repeat(40)}\n---\n\nReads well.\n`,
        [`after:${PR}/pr.md`]: pr(1),
      }),
    );
    assert.deepEqual(summary, {
      verb: "review",
      kind: "pr",
      entity: "dk3mp2x9",
      title: "Raise the deadline",
      facts: [{ field: "verdict", before: null, after: "approve" }],
    });
  });

  it("takes the verb of an `nb:` subject, and names `comment on` as a comment", () => {
    const comment = `${OPEN}/comments/2026-08-05T090000Z-cccc0001.md`;
    const read = reader({
      [`after:${comment}`]: "---\nauthor: B <b@example.invalid>\n---\n\nSame here.\n",
    });
    for (const subject of ["nb: comment on #bqlybac0", "docs(issue): comment on #bqlybac0"]) {
      const summary = summariseTrackerCommit(subject, [file(comment, "added")], NAV, read);
      assert.equal(summary?.verb, "comment", subject);
      assert.equal(summary?.kind, "issue", subject);
    }
  });

  it("reads the files when the words before the ID are not a verb", () => {
    const summary = summariseTrackerCommit(
      "docs(issue): attach the profiling harness to #bqlybac0",
      [file(`${OPEN}/harness.ts`, "added")],
      NAV,
      reader({}),
    );
    assert.equal(summary?.verb, "edit");
    assert.equal(summary?.entity, "bqlybac0");
  });

  it("reads a reopen and a merge from the directory the record moved to", () => {
    const reopened = summariseTrackerCommit(
      "Reopen it",
      [file(`${OPEN}/issue.md`, "renamed", `${CLOSED}/issue.md`)],
      NAV,
      reader({}),
    );
    assert.equal(reopened?.verb, "reopen");
    const merged = summariseTrackerCommit(
      "Merge it",
      [file(`${NAV}/prs/merged/dk3mp2x9-raise-the-deadline/pr.md`, "renamed", `${PR}/pr.md`)],
      NAV,
      reader({}),
    );
    assert.equal(merged?.verb, "merge");
  });

  it("finds a record under an archive year", () => {
    const summary = summariseTrackerCommit(
      "Archive",
      [
        file(
          `${NAV}/archive/2025/issues/closed/bqlybac0-login-timeout/issue.md`,
          "renamed",
          `${CLOSED}/issue.md`,
        ),
      ],
      NAV,
      reader({}),
    );
    assert.equal(summary?.entity, "bqlybac0");
    assert.equal(summary?.kind, "issue");
  });

  it("leaves a plugin's files to their subject: they name no record here", () => {
    assert.equal(
      summariseTrackerCommit(
        "docs(feature): create auth",
        [file(`${NAV}/specs/auth/feature.md`, "added")],
        NAV,
        reader({}),
      ),
      null,
    );
  });

  it("is about the record the subject names, when the commit touches several", () => {
    const summary = summariseTrackerCommit(
      "docs(pr): open #dk3mp2x9",
      [file(`${OPEN}/issue.md`, "modified"), file(`${PR}/pr.md`, "added")],
      NAV,
      reader({}),
    );
    assert.equal(summary?.entity, "dk3mp2x9");
  });

  it("is null for a commit that touched no record", () => {
    assert.equal(
      summariseTrackerCommit(
        "chore: marker",
        [file(`${NAV}/navbook.json`, "modified")],
        NAV,
        reader({}),
      ),
      null,
    );
  });
});
