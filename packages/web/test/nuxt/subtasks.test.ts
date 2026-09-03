/**
 * The four things a decomposition link can be, and the one it usually is.
 *
 * Each is a different thing to tell the reader, so each has to be recognised
 * separately — and the order the flags are checked in matters, because a node
 * can carry both an issue and a flag. The flag is the reason it was not
 * expanded, and that is what the reader needs.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { countSubtasks, type LinkTreeNode, linkNote, linkState } from "../../app/utils/subtasks";

function node(overrides: Partial<LinkTreeNode> = {}): LinkTreeNode {
  return {
    id: "aaaa0001",
    notAnIssue: false,
    cycle: false,
    repeated: false,
    issue: { id: "aaaa0001", title: "An issue", status: "OPEN" },
    ...overrides,
  };
}

describe("linkState", () => {
  it("is an issue when nothing is the matter", () => {
    assert.equal(linkState(node()), "issue");
  });

  it("names an id that resolves to nothing in this checkout", () => {
    // The issue may be real and on a branch this server does not hold.
    assert.equal(linkState(node({ issue: null })), "unknown");
  });

  it("names a pull request, which decomposition never relates", () => {
    assert.equal(linkState(node({ notAnIssue: true, issue: null })), "notAnIssue");
  });

  it("prefers the flag when a node carries both an issue and a reason", () => {
    // `cycle` and `repeated` come back with the issue attached — the flag is
    // why it was not expanded, and that is the thing worth saying.
    assert.equal(linkState(node({ cycle: true })), "cycle");
    assert.equal(linkState(node({ repeated: true })), "repeated");
  });

  it("puts a pull request ahead of every other reason", () => {
    assert.equal(linkState(node({ notAnIssue: true, cycle: true, repeated: true })), "notAnIssue");
  });

  it("puts a loop ahead of a repeat", () => {
    assert.equal(linkState(node({ cycle: true, repeated: true })), "cycle");
  });
});

describe("linkNote", () => {
  it("explains every state but the ordinary one", () => {
    assert.equal(linkNote("issue"), null);
    for (const state of ["notAnIssue", "cycle", "repeated", "unknown"] as const) {
      assert.equal(typeof linkNote(state), "string");
      assert.notEqual(linkNote(state), "");
    }
  });
});

describe("countSubtasks", () => {
  it("counts nothing for nothing", () => {
    assert.equal(countSubtasks([]), 0);
  });

  it("counts only what it can actually show", () => {
    const forest: LinkTreeNode[] = [
      node({ id: "a" }),
      node({ id: "b", notAnIssue: true, issue: null }),
      node({ id: "c", issue: null }),
      node({ id: "d", cycle: true }),
      node({ id: "e", repeated: true }),
    ];
    assert.equal(countSubtasks(forest), 1);
  });

  it("counts down the tree", () => {
    const forest: LinkTreeNode[] = [
      node({ id: "a", children: [node({ id: "b", children: [node({ id: "c" })] })] }),
    ];
    assert.equal(countSubtasks(forest), 3);
  });

  it("copes with children that are absent or null", () => {
    assert.equal(countSubtasks([node({ children: null })]), 1);
    assert.equal(countSubtasks([node({ children: [] })]), 1);
  });
});
