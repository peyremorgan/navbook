import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { mergeTimeline, type TimelineEvent } from "../../app/utils/timeline";

const issue = (id: string, created: string) => ({ id, created });
const commit = (sha: string, date: string) => ({
  sha,
  subject: `subject ${sha}`,
  author: "A Person <a@example.invalid>",
  date,
});

const keys = (events: TimelineEvent[]): string[] => events.map((event) => event.key);

describe("mergeTimeline", () => {
  it("is empty when there is nothing to show", () => {
    assert.deepEqual(mergeTimeline({}), []);
  });

  it("puts everything in one list, newest first", () => {
    const events = mergeTimeline({
      issues: [issue("aaaa0001", "2026-09-01T10:00:00Z")],
      prs: [issue("bbbb0001", "2026-09-03T10:00:00Z")],
      commits: [commit("c1", "2026-09-02T10:00:00Z"), commit("c2", "2026-09-04T10:00:00Z")],
    });
    assert.deepEqual(keys(events), ["c2", "bbbb0001", "c1", "aaaa0001"]);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["commit", "pr", "commit", "issue"],
    );
  });

  it("compares instants rather than the text they were written as", () => {
    // Ten in Paris is eight in UTC, so the issue is the older of the two.
    const events = mergeTimeline({
      issues: [issue("aaaa0001", "2026-09-01T10:00:00+02:00")],
      commits: [commit("c1", "2026-09-01T09:00:00Z")],
    });
    assert.deepEqual(keys(events), ["c1", "aaaa0001"]);
  });

  it("puts the commit first when it shares an instant with the entity it filed", () => {
    const events = mergeTimeline({
      issues: [issue("aaaa0001", "2026-09-01T10:00:00Z")],
      commits: [commit("c1", "2026-09-01T10:00:00Z")],
    });
    assert.deepEqual(keys(events), ["c1", "aaaa0001"]);
  });

  it("breaks a remaining tie stably, so two renders agree", () => {
    const at = "2026-09-01T10:00:00Z";
    const events = mergeTimeline({ issues: [issue("bbbb0002", at), issue("aaaa0001", at)] });
    assert.deepEqual(keys(events), ["aaaa0001", "bbbb0002"]);
    assert.deepEqual(
      keys(mergeTimeline({ issues: [issue("aaaa0001", at), issue("bbbb0002", at)] })),
      ["aaaa0001", "bbbb0002"],
    );
  });

  it("sorts a timestamp it cannot read to the bottom rather than dropping it", () => {
    const events = mergeTimeline({
      issues: [issue("aaaa0001", "not a date"), issue("bbbb0002", "2026-09-01T10:00:00Z")],
    });
    assert.deepEqual(keys(events), ["bbbb0002", "aaaa0001"]);
  });
});
