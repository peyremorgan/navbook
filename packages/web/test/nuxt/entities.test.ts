/**
 * The small presentational facts, and the one that is not small: a comment's
 * timestamp is spelled differently from an entity's, because a filename cannot
 * hold colons.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  absoluteTime,
  distinctValues,
  parseTimestamp,
  relativeTime,
  shortId,
  shortSha,
  statusColor,
  statusLabel,
} from "../../app/utils/entities";

describe("parseTimestamp", () => {
  it("reads the ordinary spelling an entity's `created` uses", () => {
    assert.equal(parseTimestamp("2026-08-01T10:00:00Z")?.toISOString(), "2026-08-01T10:00:00.000Z");
  });

  it("reads the colon-free spelling a comment's does", () => {
    // This is what a comment filename is, and the API reports it verbatim.
    assert.equal(parseTimestamp("2026-08-04T110000Z")?.toISOString(), "2026-08-04T11:00:00.000Z");
  });

  it("tolerates surrounding space", () => {
    assert.equal(
      parseTimestamp("  2026-08-04T110000Z  ")?.toISOString(),
      "2026-08-04T11:00:00.000Z",
    );
  });

  it("returns null rather than an invalid date", () => {
    for (const bad of ["", "not a date", "2026-13-45T999999Z", "2026-08-04T1100Z"]) {
      assert.equal(parseTimestamp(bad), null, bad);
    }
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-03T12:00:00Z");

  it("counts back in the largest unit that fits", () => {
    assert.equal(relativeTime("2026-09-03T11:59:30Z", now), "30 seconds ago");
    assert.equal(relativeTime("2026-09-03T11:30:00Z", now), "30 minutes ago");
    assert.equal(relativeTime("2026-09-03T06:00:00Z", now), "6 hours ago");
    assert.equal(relativeTime("2026-09-01T12:00:00Z", now), "2 days ago");
    assert.equal(relativeTime("2026-07-03T12:00:00Z", now), "2 months ago");
    assert.equal(relativeTime("2024-09-03T12:00:00Z", now), "2 years ago");
  });

  it("handles a comment's spelling, which is the one that appears most", () => {
    assert.equal(relativeTime("2026-09-03T113000Z", now), "30 minutes ago");
  });

  it("looks forward as readily as back, for a clock that disagrees", () => {
    assert.match(relativeTime("2026-09-03T12:30:00Z", now), /in 30 minutes/);
  });

  it("shows an unreadable timestamp rather than swallowing it", () => {
    assert.equal(relativeTime("whenever", now), "whenever");
    assert.equal(absoluteTime("whenever"), "whenever");
  });
});

describe("statuses", () => {
  it("gives each one a colour and a name", () => {
    assert.equal(statusColor("OPEN"), "success");
    assert.equal(statusColor("MERGED"), "primary");
    assert.equal(statusColor("CLOSED"), "neutral");
    assert.equal(statusLabel("OPEN"), "Open");
    assert.equal(statusLabel("REQUEST_CHANGES" as never), "Request_changes");
  });
});

describe("shortening", () => {
  it("keeps the whole id, which is already short", () => {
    assert.equal(shortId("aaaa0001"), "aaaa0001");
  });

  it("shortens a sha the way git speaks about one", () => {
    assert.equal(shortSha("0123456789abcdef0123456789abcdef01234567"), "0123456");
    assert.equal(shortSha("abc"), "abc");
  });
});

describe("distinctValues", () => {
  const rows = [{ labels: ["bug", "Auth"] }, { labels: ["BUG", "docs"] }, { labels: [] }];

  it("folds case and keeps the first spelling seen", () => {
    // The server compares labels case-insensitively, so `Bug` and `bug` are one
    // label there; showing two would offer a filter that cannot narrow.
    assert.deepEqual(
      distinctValues(rows, (row) => row.labels),
      ["Auth", "bug", "docs"],
    );
  });

  it("is empty for an empty listing", () => {
    assert.deepEqual(
      distinctValues([], () => []),
      [],
    );
  });
});
