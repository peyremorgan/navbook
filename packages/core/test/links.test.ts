import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ancestorsOf,
  descendantsOf,
  faultPath,
  findLinkFaults,
  findLinkLoops,
  inParentChain,
  type LinkFault,
  linkRefusal,
  listersOf,
  parentOf,
  planFaultRepair,
  subtaskTree,
} from "../src/core/links.ts";
import { type EntityRecord, type NavTree, parseTree, type Repo } from "../src/core/tree.ts";

/** An issue file whose title doubles as a marker in rendered output. */
const issue = (id: string, links = ""): [string, string] => [
  `issues/open/${id}-x/issue.md`,
  `---\ntitle: Issue ${id}\nauthor: a@example.com\ncreated: 2026-08-02T09:14:00Z\n${links}---\n\nBody.\n`,
];

const pr = (id: string, links = ""): [string, string] => [
  `prs/open/${id}-x/pr.md`,
  `---\ntitle: PR ${id}\nauthor: a@example.com\ncreated: 2026-08-02T09:14:00Z\ntarget: main\n${links}revisions:\n  - head: ${"a".repeat(40)}\n    base: ${"b".repeat(40)}\n    date: 2026-08-02T09:14:00Z\n---\n\nBody.\n`,
];

const repoOf = (...entries: [string, string][]): Repo => parseTree(new Map(entries) as NavTree);

const get = (repo: Repo, id: string): EntityRecord => {
  const entity = repo.byId.get(id);
  assert.ok(entity, `#${id} is not in the tree`);
  return entity;
};

const kinds = (faults: readonly LinkFault[]): string[] => faults.map((f) => f.kind).sort();

/* A three-generation tree: a1 -> b1 -> c1, with b2 a second child of a1. */
const family = (): Repo =>
  repoOf(
    issue("a1000000", "subtasks: [b1000000, b2000000]\n"),
    issue("b1000000", "parent: a1000000\nsubtasks: [c1000000]\n"),
    issue("b2000000", "parent: a1000000\n"),
    issue("c1000000", "parent: b1000000\n"),
  );

describe("walking the parent chain", () => {
  it("resolves a parent that is in the tree", () => {
    const repo = family();
    assert.equal(parentOf(repo, get(repo, "b1000000"))?.id, "a1000000");
    assert.equal(parentOf(repo, get(repo, "a1000000")), undefined);
  });

  it("treats a dangling parent as no parent, since nothing can be said about it", () => {
    const repo = repoOf(issue("a1000000", "parent: zz999999\n"));
    assert.equal(parentOf(repo, get(repo, "a1000000")), undefined);
  });

  it("never follows a link to a pull request", () => {
    const repo = repoOf(issue("a1000000", "parent: dk3mp2x9\n"), pr("dk3mp2x9"));
    assert.equal(parentOf(repo, get(repo, "a1000000")), undefined);
  });

  it("lists ancestors nearest first", () => {
    const repo = family();
    assert.deepEqual(
      ancestorsOf(repo, get(repo, "c1000000")).map((e) => e.id),
      ["b1000000", "a1000000"],
    );
  });

  it("stops at a loop rather than walking forever", () => {
    const repo = repoOf(
      issue("a1000000", "parent: b1000000\n"),
      issue("b1000000", "parent: a1000000\n"),
    );
    assert.deepEqual(
      ancestorsOf(repo, get(repo, "a1000000")).map((e) => e.id),
      ["b1000000"],
    );
  });

  it("counts an issue as being in its own chain", () => {
    const repo = family();
    assert.equal(inParentChain(repo, get(repo, "c1000000"), "c1000000"), true);
    assert.equal(inParentChain(repo, get(repo, "c1000000"), "a1000000"), true);
    assert.equal(inParentChain(repo, get(repo, "a1000000"), "c1000000"), false);
  });
});

describe("descendantsOf", () => {
  it("collects the whole subtree, nearest generation first", () => {
    const repo = family();
    assert.deepEqual(
      descendantsOf(repo, get(repo, "a1000000")).map((e) => e.id),
      ["b1000000", "b2000000", "c1000000"],
    );
    assert.deepEqual(descendantsOf(repo, get(repo, "c1000000")), []);
  });

  it("follows 'parent', not 'subtasks': a list entry that does not agree is not a subtask", () => {
    const repo = repoOf(issue("a1000000", "subtasks: [b1000000]\n"), issue("b1000000"));
    assert.deepEqual(descendantsOf(repo, get(repo, "a1000000")), []);
  });

  it("terminates on a loop", () => {
    const repo = repoOf(
      issue("a1000000", "parent: b1000000\n"),
      issue("b1000000", "parent: a1000000\n"),
    );
    assert.deepEqual(
      descendantsOf(repo, get(repo, "a1000000")).map((e) => e.id),
      ["b1000000"],
    );
  });
});

describe("listersOf", () => {
  it("finds every issue claiming one, whether or not it agrees", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("a2000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "parent: a1000000\n"),
    );
    assert.deepEqual(
      listersOf(repo, "c1000000").map((e) => e.id),
      ["a1000000", "a2000000"],
    );
  });
});

describe("linkRefusal", () => {
  it("allows an ordinary link", () => {
    const repo = family();
    assert.equal(linkRefusal(repo, get(repo, "b2000000"), get(repo, "b1000000")), null);
  });

  it("refuses an issue as its own parent", () => {
    const repo = family();
    const a = get(repo, "a1000000");
    assert.deepEqual(linkRefusal(repo, a, a), { kind: "self" });
  });

  it("refuses a link that would close a loop, naming the chain", () => {
    const repo = family();
    assert.deepEqual(linkRefusal(repo, get(repo, "a1000000"), get(repo, "c1000000")), {
      kind: "cycle",
      chain: ["c1000000", "b1000000", "a1000000"],
    });
  });

  it("refuses a link both sides already record", () => {
    const repo = family();
    assert.deepEqual(linkRefusal(repo, get(repo, "b1000000"), get(repo, "a1000000")), {
      kind: "already-linked",
    });
  });

  it("allows relinking when only one side records it, so the command can mend it", () => {
    const repo = repoOf(issue("a1000000"), issue("b1000000", "parent: a1000000\n"));
    assert.equal(linkRefusal(repo, get(repo, "b1000000"), get(repo, "a1000000")), null);
  });
});

describe("findLinkFaults", () => {
  it("says nothing about a tree whose links agree", () => {
    assert.deepEqual(findLinkFaults(family()), []);
  });

  it("reports a parent that does not list a child naming it, against the parent's file", () => {
    const repo = repoOf(issue("a1000000"), issue("b1000000", "parent: a1000000\n"));
    const faults = findLinkFaults(repo);
    assert.deepEqual(kinds(faults), ["parent-missing-child"]);
    assert.equal(faultPath(faults[0] as LinkFault), "issues/open/a1000000-x/issue.md");
  });

  it("reports a child that records no parent, against the child's file", () => {
    const repo = repoOf(issue("a1000000", "subtasks: [b1000000]\n"), issue("b1000000"));
    const faults = findLinkFaults(repo);
    assert.deepEqual(kinds(faults), ["child-missing-parent"]);
    assert.equal(faultPath(faults[0] as LinkFault), "issues/open/b1000000-x/issue.md");
  });

  it("reports two issues claiming the same subtask as one conflict", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("a2000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "parent: a1000000\n"),
    );
    const faults = findLinkFaults(repo);
    assert.deepEqual(kinds(faults), ["conflict"]);
    const fault = faults[0] as Extract<LinkFault, { kind: "conflict" }>;
    assert.deepEqual(fault.claimants, ["a1000000", "a2000000"]);
    assert.equal(faultPath(fault), "issues/open/c1000000-x/issue.md");
  });

  it("counts a parent nobody can see as a claim, so a lister contradicting it conflicts", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "parent: zz999999\n"),
    );
    assert.deepEqual(kinds(findLinkFaults(repo)), ["conflict"]);
  });

  it("leaves a lone dangling parent to check D8", () => {
    assert.deepEqual(findLinkFaults(repoOf(issue("c1000000", "parent: zz999999\n"))), []);
  });

  it("reports a repeated entry once, however often it repeats", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [b1000000, b1000000, b1000000]\n"),
      issue("b1000000", "parent: a1000000\n"),
    );
    assert.deepEqual(kinds(findLinkFaults(repo)), ["duplicate"]);
  });

  it("reports a link naming a pull request, from either side", () => {
    const fromChild = repoOf(issue("a1000000", "parent: dk3mp2x9\n"), pr("dk3mp2x9"));
    const fromParent = repoOf(issue("a1000000", "subtasks: [dk3mp2x9]\n"), pr("dk3mp2x9"));
    assert.deepEqual(kinds(findLinkFaults(fromChild)), ["not-an-issue"]);
    assert.deepEqual(kinds(findLinkFaults(fromParent)), ["not-an-issue"]);
  });

  it("leaves self-reference to check D12 rather than reporting it twice", () => {
    const repo = repoOf(issue("a1000000", "parent: a1000000\nsubtasks: [a1000000]\n"));
    assert.deepEqual(findLinkFaults(repo), []);
  });

  it("says nothing about a loop whose links agree; that is D12's alone", () => {
    const repo = repoOf(
      issue("a1000000", "parent: b1000000\nsubtasks: [b1000000]\n"),
      issue("b1000000", "parent: a1000000\nsubtasks: [a1000000]\n"),
    );
    assert.deepEqual(findLinkFaults(repo), []);
  });
});

describe("planFaultRepair", () => {
  const never = (): null => null;

  it("adds the missing entry to a parent's list", () => {
    const repo = repoOf(issue("a1000000"), issue("b1000000", "parent: a1000000\n"));
    const plan = planFaultRepair(repo, findLinkFaults(repo)[0] as LinkFault, never);
    assert.deepEqual(plan, [
      { entity: get(repo, "a1000000"), edit: { addSubtasks: ["b1000000"] } },
    ]);
  });

  it("sets the missing parent on a child", () => {
    const repo = repoOf(issue("a1000000", "subtasks: [b1000000]\n"), issue("b1000000"));
    const plan = planFaultRepair(repo, findLinkFaults(repo)[0] as LinkFault, never);
    assert.deepEqual(plan, [{ entity: get(repo, "b1000000"), edit: { parent: "a1000000" } }]);
  });

  it("declines to set a parent when doing so would close a loop", () => {
    // b1 is filed under a1 and claims a1 as its subtask. Answering the claim
    // would put a1 under b1, and b1 under a1.
    const repo = repoOf(
      issue("a1000000"),
      issue("b1000000", "parent: a1000000\nsubtasks: [a1000000]\n"),
    );
    const fault = findLinkFaults(repo).find((f) => f.kind === "child-missing-parent");
    assert.ok(fault, "a1 is listed by b1 but names no parent");
    assert.equal(planFaultRepair(repo, fault, never), null);
  });

  it("declines a conflict the resolver will not settle", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("a2000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "parent: a1000000\n"),
    );
    assert.equal(planFaultRepair(repo, findLinkFaults(repo)[0] as LinkFault, never), null);
  });

  it("reconciles every claimant once the resolver picks a winner", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("a2000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "parent: a1000000\n"),
    );
    const plan = planFaultRepair(repo, findLinkFaults(repo)[0] as LinkFault, () => "a2000000");
    assert.deepEqual(plan, [
      { entity: get(repo, "c1000000"), edit: { parent: "a2000000" } },
      { entity: get(repo, "a2000000"), edit: { addSubtasks: ["c1000000"] } },
      { entity: get(repo, "a1000000"), edit: { removeSubtasks: ["c1000000"] } },
    ]);
  });

  it("refuses a winner that would put the child under its own descendant", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "subtasks: [d1000000]\n"),
      issue("d1000000", "parent: c1000000\nsubtasks: [c1000000]\n"),
    );
    const conflict = findLinkFaults(repo).find((f) => f.kind === "conflict");
    assert.ok(conflict, "a1 and d1 both claim c1");
    assert.equal(
      planFaultRepair(repo, conflict, () => "d1000000"),
      null,
    );
  });

  it("offers no repair for a link naming a pull request", () => {
    const repo = repoOf(issue("a1000000", "parent: dk3mp2x9\n"), pr("dk3mp2x9"));
    assert.equal(planFaultRepair(repo, findLinkFaults(repo)[0] as LinkFault, never), null);
  });
});

describe("findLinkLoops", () => {
  it("finds nothing in a tree", () => {
    assert.deepEqual(findLinkLoops(family()), []);
  });

  it("reports an issue that is its own parent", () => {
    const repo = repoOf(issue("a1000000", "parent: a1000000\n"));
    assert.deepEqual(findLinkLoops(repo), [
      { ids: ["a1000000"], path: "issues/open/a1000000-x/issue.md", via: "parent" },
    ]);
  });

  it("reports an issue that lists itself", () => {
    const repo = repoOf(issue("a1000000", "subtasks: [a1000000]\n"));
    assert.deepEqual(findLinkLoops(repo), [
      { ids: ["a1000000"], path: "issues/open/a1000000-x/issue.md", via: "subtasks" },
    ]);
  });

  it("reports a longer loop once, whichever member it is reached from", () => {
    const repo = repoOf(
      issue("c1000000", "parent: a1000000\n"),
      issue("a1000000", "parent: b1000000\n"),
      issue("b1000000", "parent: c1000000\n"),
    );
    assert.deepEqual(findLinkLoops(repo), [
      {
        ids: ["a1000000", "b1000000", "c1000000"],
        path: "issues/open/a1000000-x/issue.md",
        via: "parent",
      },
    ]);
  });

  it("does not mistake a chain that merely leads into a loop for a second loop", () => {
    const repo = repoOf(
      issue("z1000000", "parent: a1000000\n"),
      issue("a1000000", "parent: b1000000\n"),
      issue("b1000000", "parent: a1000000\n"),
    );
    assert.equal(findLinkLoops(repo).length, 1);
    assert.deepEqual(findLinkLoops(repo)[0]?.ids, ["a1000000", "b1000000"]);
  });
});

describe("subtaskTree", () => {
  it("renders one level by default", () => {
    const repo = family();
    const tree = subtaskTree(repo, get(repo, "a1000000"), 1);
    assert.deepEqual(
      tree.map((n) => [n.id, n.children.length]),
      [
        ["b1000000", 0],
        ["b2000000", 0],
      ],
    );
  });

  it("descends as far as it is asked to", () => {
    const repo = family();
    const tree = subtaskTree(repo, get(repo, "a1000000"), 2);
    assert.deepEqual(
      tree[0]?.children.map((n) => n.id),
      ["c1000000"],
    );
  });

  it("renders nothing at depth zero", () => {
    const repo = family();
    assert.deepEqual(subtaskTree(repo, get(repo, "a1000000"), 0), []);
  });

  it("keeps an entry no file backs, so the list is shown as written", () => {
    const repo = repoOf(issue("a1000000", "subtasks: [zz999999]\n"));
    const tree = subtaskTree(repo, get(repo, "a1000000"), 1);
    assert.deepEqual(tree, [{ id: "zz999999", children: [] }]);
  });

  it("marks the entry that loops back instead of recursing into it", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [b1000000]\n"),
      issue("b1000000", "subtasks: [a1000000]\n"),
    );
    const tree = subtaskTree(repo, get(repo, "a1000000"), 10);
    assert.equal(tree[0]?.children[0]?.id, "a1000000");
    assert.equal(tree[0]?.children[0]?.cycle, true);
    assert.deepEqual(tree[0]?.children[0]?.children, []);
  });

  it("expands an issue two lists share only once", () => {
    const repo = repoOf(
      issue("a1000000", "subtasks: [b1000000, b2000000]\n"),
      issue("b1000000", "subtasks: [c1000000]\n"),
      issue("b2000000", "subtasks: [c1000000]\n"),
      issue("c1000000", "subtasks: [d1000000]\n"),
      issue("d1000000"),
    );
    const tree = subtaskTree(repo, get(repo, "a1000000"), 10);
    assert.deepEqual(
      tree[0]?.children[0]?.children.map((n) => n.id),
      ["d1000000"],
    );
    assert.equal(tree[1]?.children[0]?.repeated, true);
    assert.deepEqual(tree[1]?.children[0]?.children, []);
  });
});
