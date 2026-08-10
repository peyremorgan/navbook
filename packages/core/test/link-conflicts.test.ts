import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkConflict } from "../src/core/links.ts";
import { type EntityRecord, type NavTree, parseTree } from "../src/core/tree.ts";
import { decideConflict } from "../src/workspace/link-conflicts.ts";

const issue = (id: string, links = ""): [string, string] => [
  `issues/open/${id}-x/issue.md`,
  `---\ntitle: Issue ${id}\nauthor: a@example.com\ncreated: 2026-08-02T09:14:00Z\n${links}---\n\nBody.\n`,
];

function entities(...entries: [string, string][]): Record<string, EntityRecord> {
  const repo = parseTree(new Map(entries) as NavTree);
  return Object.fromEntries(repo.issues.map((entity) => [entity.id, entity]));
}

/** #c1000000 is claimed by its own file (a1) and by a2's `subtasks` list. */
function disputed(): LinkConflict {
  const by = entities(
    issue("a1000000", "subtasks: [c1000000]\n"),
    issue("a2000000", "subtasks: [c1000000]\n"),
    issue("c1000000", "parent: a1000000\n"),
  );
  return {
    kind: "conflict",
    child: by.c1000000 as EntityRecord,
    claimants: ["a1000000", "a2000000"],
    listers: [by.a1000000 as EntityRecord, by.a2000000 as EntityRecord],
  };
}

/** A stub history in which each named file last changed at the given time. */
const at =
  (times: Record<string, string>) =>
  (filePath: string): Date | null => {
    const stamp = times[filePath];
    return stamp === undefined ? null : new Date(stamp);
  };

const CHILD = "issues/open/c1000000-x/issue.md";
const A1 = "issues/open/a1000000-x/issue.md";
const A2 = "issues/open/a2000000-x/issue.md";

describe("decideConflict", () => {
  it("gives it to the claim that was made last", () => {
    // The child and a1 agree, so a1's claim is dated by the later of the two.
    const winner = decideConflict(
      disputed(),
      at({
        [CHILD]: "2026-08-01T00:00:00Z",
        [A1]: "2026-08-02T00:00:00Z",
        [A2]: "2026-08-03T00:00:00Z",
      }),
    );
    assert.equal(winner, "a2000000");
  });

  it("counts a claim as reaffirmed by the later of the two files that make it", () => {
    const winner = decideConflict(
      disputed(),
      at({
        [CHILD]: "2026-08-09T00:00:00Z",
        [A1]: "2026-08-01T00:00:00Z",
        [A2]: "2026-08-03T00:00:00Z",
      }),
    );
    assert.equal(winner, "a1000000");
  });

  it("declines when two claims are the same age, having nothing to prefer", () => {
    assert.equal(
      decideConflict(
        disputed(),
        at({
          [CHILD]: "2026-08-01T00:00:00Z",
          [A1]: "2026-08-03T00:00:00Z",
          [A2]: "2026-08-03T00:00:00Z",
        }),
      ),
      null,
    );
  });

  it("declines when any claim has no history, since it may be the newest", () => {
    assert.equal(
      decideConflict(
        disputed(),
        at({ [CHILD]: "2026-08-01T00:00:00Z", [A1]: "2026-08-02T00:00:00Z" }),
      ),
      null,
    );
    assert.equal(
      decideConflict(
        disputed(),
        at({ [A1]: "2026-08-02T00:00:00Z", [A2]: "2026-08-03T00:00:00Z" }),
      ),
      null,
    );
  });

  it("declines outright when nothing is committed", () => {
    assert.equal(
      decideConflict(disputed(), () => null),
      null,
    );
  });
});
