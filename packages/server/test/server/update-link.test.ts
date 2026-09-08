/**
 * Editing an issue, and filing one under another.
 *
 * These are the two mutations with a shape of their own: a patch must leave
 * everything it does not name alone, and a link that moves a subtask must be
 * consented to rather than assumed.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id path } }
}`;

const UPDATE = `mutation Update($input: UpdateIssueInput!) {
  updateIssue(input: $input) {
    issue { id title body labels assignees milestone }
    commit { committed subject pushed }
  }
}`;

interface UpdateResult {
  updateIssue: {
    issue: {
      id: string;
      title: string;
      body: string;
      labels: string[];
      assignees: string[];
      milestone: string | null;
    };
    commit: { committed: boolean; subject: string; pushed: boolean };
  };
}

describe("updateIssue", () => {
  let h: Harness;

  const fileOf = (path: string): string => readFileSync(join(h.fixture.server.dir, path), "utf8");

  const open = async (input: Record<string, unknown>): Promise<{ id: string; path: string }> =>
    ok<{ openIssue: { issue: { id: string; path: string } } }>(await h.gql(OPEN, { input }))
      .openIssue.issue;

  const update = async (input: Record<string, unknown>): Promise<UpdateResult["updateIssue"]> =>
    ok<UpdateResult>(await h.gql(UPDATE, { input })).updateIssue;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("changes only the fields the patch names", async () => {
    const issue = await open({
      title: "Before",
      body: "Original body.",
      labels: ["one"],
      milestone: "v1",
    });

    const result = await update({ ref: issue.id, title: "After" });
    assert.equal(result.issue.title, "After");
    // Untouched, because the patch did not name them.
    assert.equal(result.issue.body, "Original body.");
    assert.deepEqual(result.issue.labels, ["one"]);
    assert.equal(result.issue.milestone, "v1");
    assert.equal(result.commit.committed, true);
    assert.equal(result.commit.pushed, true);
    assert.equal(result.commit.subject, `docs(issue): edit #${issue.id}`);
  });

  it("replaces the body without disturbing the frontmatter", async () => {
    const issue = await open({ title: "Body swap", body: "Old." });
    const before = fileOf(`${issue.path}/issue.md`).split("---\n")[1];

    const result = await update({ ref: issue.id, body: "New." });
    assert.equal(result.issue.body, "New.");
    // The YAML block is replayed as it was written, not round-tripped.
    assert.equal(fileOf(`${issue.path}/issue.md`).split("---\n")[1], before);
  });

  it("clears a key with an explicit null, and leaves it alone when absent", async () => {
    const issue = await open({ title: "Clearing", body: "x", milestone: "v1", labels: ["keep"] });

    const cleared = await update({ ref: issue.id, milestone: null });
    assert.equal(cleared.issue.milestone, null);
    // Only what was named: the labels are still there.
    assert.deepEqual(cleared.issue.labels, ["keep"]);
    assert.doesNotMatch(fileOf(`${issue.path}/issue.md`), /^milestone:/m);
  });

  it("treats an empty list as clearing it", async () => {
    const issue = await open({ title: "Emptying", body: "x", labels: ["a", "b"] });

    const cleared = await update({ ref: issue.id, labels: [] });
    assert.deepEqual(cleared.issue.labels, []);
    assert.doesNotMatch(fileOf(`${issue.path}/issue.md`), /^labels:/m);
  });

  it("writes one assignee as a scalar and several as a list", async () => {
    const issue = await open({ title: "Assigning", body: "x" });

    await update({ ref: issue.id, assignees: ["A <a@example.invalid>"] });
    assert.match(fileOf(`${issue.path}/issue.md`), /^assignee: A <a@example\.invalid>$/m);

    const many = await update({
      ref: issue.id,
      assignees: ["A <a@example.invalid>", "B <b@example.invalid>"],
    });
    assert.deepEqual(many.issue.assignees, ["A <a@example.invalid>", "B <b@example.invalid>"]);
    assert.match(fileOf(`${issue.path}/issue.md`), /^assignee: \[A <.+>, B <.+>\]$/m);
  });

  it("preserves frontmatter keys the schema does not name", async () => {
    const issue = await open({ title: "Unknown keys", body: "x" });
    const path = `${issue.path}/issue.md`;

    // A key from a future version of the format, or a hand edit (spec 02 §2.4).
    const doctored = fileOf(path).replace(
      /^created: (.+)$/m,
      "created: $1\nimported-from: github:acme/repo#12",
    );
    h.fixture.server.write(path, doctored);
    h.fixture.server.commitAll("hand edit");

    await update({ ref: issue.id, title: "Renamed" });

    const after = fileOf(path);
    assert.match(after, /^imported-from: github:acme\/repo#12$/m);
    assert.match(after, /^title: Renamed$/m);
  });

  it("refuses a patch that names nothing, and one that empties a required field", async () => {
    const issue = await open({ title: "Guarded", body: "x" });
    assert.equal(errorCode(await h.gql(UPDATE, { input: { ref: issue.id } })), "INVALID_INPUT");
    assert.equal(
      errorCode(await h.gql(UPDATE, { input: { ref: issue.id, title: "  " } })),
      "INVALID_INPUT",
    );
    assert.equal(
      errorCode(await h.gql(UPDATE, { input: { ref: issue.id, body: "" } })),
      "INVALID_INPUT",
    );
    // The refusal left the file as it was.
    assert.match(fileOf(`${issue.path}/issue.md`), /^title: Guarded$/m);
  });

  it("puts the file back when the edit cannot be committed", async () => {
    const issue = await open({ title: "Rolled back", body: "Original." });
    const path = `${issue.path}/issue.md`;
    const before = fileOf(path);

    // Something unrelated is staged in the clone, which --commit refuses to
    // run alongside (spec 04 §4.2). Unlike every other operation, this one has
    // already written the file by the time that guard runs.
    h.fixture.server.write("unrelated.txt", "not ours\n");
    h.fixture.server.git(["add", "unrelated.txt"]);
    try {
      const refused = await h.gql(UPDATE, { input: { ref: issue.id, title: "Never landed" } });
      assert.equal(errorCode(refused), "UNRELATED_STAGED");

      // The patched file must not survive the failure: it would become the
      // base of the next edit, and be committed under somebody else's request.
      assert.equal(fileOf(path), before);
    } finally {
      h.fixture.server.git(["reset", "--quiet", "HEAD", "--", "unrelated.txt"]);
      h.fixture.server.git(["clean", "-qf", "unrelated.txt"]);
    }

    // And the next edit sees the original, not a leftover.
    const after = await update({ ref: issue.id, title: "Landed" });
    assert.equal(after.issue.title, "Landed");
    assert.equal(after.issue.body, "Original.");
  });

  it("reports nothing to commit when the patch changes nothing", async () => {
    const issue = await open({ title: "Idempotent", body: "x" });
    const result = await update({ ref: issue.id, title: "Idempotent" });
    assert.equal(result.commit.committed, false);
    // Nothing was committed, so nothing was pushed — and saying otherwise
    // would be a lie the client could act on.
    assert.equal(result.commit.pushed, false);
  });

  /*
   * Rank and deadline through the same three states as every other field, and
   * the reason they are worth their own cases: unplacing an issue is an
   * explicit null, and a rank of zero must not be mistaken for one.
   */

  const placed = `mutation Update($input: UpdateIssueInput!) {
    updateIssue(input: $input) { issue { id rank deadline } commit { committed } }
  }`;

  const place = async (
    input: Record<string, unknown>,
  ): Promise<{ rank: number | null; deadline: string | null }> => {
    const { rank, deadline } = ok<{
      updateIssue: { issue: { rank: number | null; deadline: string | null } };
    }>(await h.gql(placed, { input })).updateIssue.issue;
    return { rank, deadline };
  };

  it("places and dates an issue that was neither", async () => {
    const issue = await open({ title: "Place me", body: "x" });
    assert.deepEqual(await place({ ref: issue.id, rank: 15, deadline: "2026-10-01" }), {
      rank: 15,
      deadline: "2026-10-01",
    });
    const file = fileOf(`${issue.path}/issue.md`);
    assert.match(file, /^rank: 15$/m);
    assert.match(file, /^deadline: 2026-10-01$/m);
  });

  it("takes a rank of zero as a position, not as an absence", async () => {
    const issue = await open({ title: "Top of the list", body: "x" });
    assert.equal((await place({ ref: issue.id, rank: 0 })).rank, 0);
    assert.match(fileOf(`${issue.path}/issue.md`), /^rank: 0$/m);
  });

  it("unplaces and undates on an explicit null, one key at a time", async () => {
    const issue = await open({ title: "Unplace me", body: "x", rank: 10, deadline: "2026-10-01" });
    // Naming one leaves the other exactly where it was.
    assert.deepEqual(await place({ ref: issue.id, rank: null }), {
      rank: null,
      deadline: "2026-10-01",
    });
    assert.deepEqual(await place({ ref: issue.id, deadline: null }), {
      rank: null,
      deadline: null,
    });
    const file = fileOf(`${issue.path}/issue.md`);
    assert.doesNotMatch(file, /^rank:/m);
    assert.doesNotMatch(file, /^deadline:/m);
  });

  it("counts unplacing as a change, so the patch is not refused as empty", async () => {
    const issue = await open({ title: "Not empty", body: "x", rank: 10 });
    const result = ok<{ updateIssue: { commit: { committed: boolean } } }>(
      await h.gql(placed, { input: { ref: issue.id, rank: null } }),
    );
    assert.equal(result.updateIssue.commit.committed, true);
  });

  it("refuses a deadline that is not a day, leaving the file as it was", async () => {
    const issue = await open({ title: "Keep it", body: "x", deadline: "2026-10-01" });
    const response = await h.gql(placed, { input: { ref: issue.id, deadline: "2026-02-30" } });
    assert.equal(errorCode(response), "INVALID_INPUT");
    assert.match(fileOf(`${issue.path}/issue.md`), /^deadline: 2026-10-01$/m);
  });

  it("leaves an unknown key alone while placing an issue", async () => {
    // The reason a patch goes through the YAML document rather than rebuilding
    // the file from known fields (spec 02 §2.4).
    const issue = await open({ title: "Imported", body: "x" });
    const path = join(h.fixture.server.dir, `${issue.path}/issue.md`);
    const original = readFileSync(path, "utf8");
    writeFileSync(
      path,
      original.replace("created:", "imported-from: github:acme/repo#12\ncreated:"),
      "utf8",
    );
    h.fixture.server.commitAll("hand edit");

    await place({ ref: issue.id, rank: 5 });
    const file = fileOf(`${issue.path}/issue.md`);
    assert.match(file, /^imported-from: github:acme\/repo#12$/m);
    assert.match(file, /^rank: 5$/m);
  });
});

describe("linkIssue and unlinkIssue", () => {
  let h: Harness;

  const open = async (title: string): Promise<string> =>
    ok<{ openIssue: { issue: { id: string } } }>(await h.gql(OPEN, { input: { title, body: "x" } }))
      .openIssue.issue.id;

  const LINK = `mutation Link($input: LinkIssueInput!) {
    linkIssue(input: $input) {
      child { id parent { id } }
      parent { id subtasks { id } }
      previousParentId
      commit { pushed }
    }
  }`;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("files one issue under another, recording both sides", async () => {
    const parent = await open("Parent");
    const child = await open("Child");

    const result = ok<{
      linkIssue: {
        child: { id: string; parent: { id: string } };
        parent: { id: string; subtasks: { id: string }[] };
        previousParentId: string | null;
        commit: { pushed: boolean };
      };
    }>(await h.gql(LINK, { input: { child, parent } })).linkIssue;

    assert.equal(result.child.parent.id, parent);
    assert.deepEqual(result.parent.subtasks, [{ id: child }]);
    assert.equal(result.previousParentId, null);
    assert.equal(result.commit.pushed, true);
  });

  it("refuses to move a subtask that already has a parent, and says which", async () => {
    const first = await open("First parent");
    const second = await open("Second parent");
    const child = await open("Moved child");
    ok(await h.gql(LINK, { input: { child, parent: first } }));

    const refused = await h.gql(LINK, { input: { child, parent: second } });
    assert.equal(errorCode(refused), "REPARENT_REQUIRED");
    assert.equal(refused.errors[0]?.extensions?.currentParentId, first);
    assert.equal(refused.errors[0]?.extensions?.currentParentTitle, "First parent");

    // Refused means nothing happened: the old link still stands on both sides.
    const before = ok<{ issue: { parent: { id: string } } }>(
      await h.gql(`query Q($ref: ID!) { issue(ref: $ref) { parent { id } } }`, { ref: child }),
    );
    assert.equal(before.issue.parent.id, first);

    const moved = ok<{
      linkIssue: { child: { parent: { id: string } }; previousParentId: string };
    }>(await h.gql(LINK, { input: { child, parent: second, allowReparent: true } })).linkIssue;
    assert.equal(moved.child.parent.id, second);
    assert.equal(moved.previousParentId, first);

    // The issue it left no longer claims it.
    const old = ok<{ issue: { subtasks: unknown[] } }>(
      await h.gql(`query Q($ref: ID!) { issue(ref: $ref) { subtasks { id } } }`, { ref: first }),
    );
    assert.deepEqual(old.issue.subtasks, []);
  });

  it("refuses a link that would make a loop, or one to itself", async () => {
    const top = await open("Top");
    const middle = await open("Middle");
    ok(await h.gql(LINK, { input: { child: middle, parent: top } }));

    // Filing the top under its own subtask would close the loop.
    const loop = await h.gql(LINK, { input: { child: top, parent: middle } });
    assert.equal(errorCode(loop), "PRECONDITION");

    const self = await h.gql(LINK, { input: { child: top, parent: top } });
    assert.equal(errorCode(self), "PRECONDITION");
  });

  it("refuses a link that is already recorded", async () => {
    const parent = await open("Settled parent");
    const child = await open("Settled child");
    ok(await h.gql(LINK, { input: { child, parent } }));
    assert.equal(errorCode(await h.gql(LINK, { input: { child, parent } })), "PRECONDITION");
  });

  it("renders a subtask forest to the depth asked for", async () => {
    const top = await open("Root");
    const mid = await open("Branch");
    const leaf = await open("Leaf");
    ok(await h.gql(LINK, { input: { child: mid, parent: top } }));
    ok(await h.gql(LINK, { input: { child: leaf, parent: mid } }));

    const shallow = ok<{ issue: { subtasks: { id: string; children: unknown[] }[] } }>(
      await h.gql(`query Q($ref: ID!) { issue(ref: $ref) { subtasks { id children { id } } } }`, {
        ref: top,
      }),
    );
    assert.deepEqual(shallow.issue.subtasks, [{ id: mid, children: [] }]);

    const deep = ok<{
      issue: { subtasks: { id: string; children: { id: string; issue: { title: string } }[] }[] };
    }>(
      await h.gql(
        `query Q($ref: ID!) { issue(ref: $ref) {
           subtasks(depth: 2) { id children { id issue { title } } }
         } }`,
        { ref: top },
      ),
    );
    assert.deepEqual(deep.issue.subtasks, [
      { id: mid, children: [{ id: leaf, issue: { title: "Leaf" } }] },
    ]);
  });

  it("refuses a negative depth", async () => {
    const issue = await open("Depth");
    const response = await h.gql(
      `query Q($ref: ID!) { issue(ref: $ref) { subtasks(depth: -1) { id } } }`,
      { ref: issue },
    );
    assert.equal(errorCode(response), "INVALID_INPUT");
  });

  it("detaches an issue from its parent", async () => {
    const parent = await open("Detaching parent");
    const child = await open("Detaching child");
    ok(await h.gql(LINK, { input: { child, parent } }));

    const result = ok<{
      unlinkIssue: {
        child: { id: string; parent: unknown };
        previousParentId: string;
        commit: { pushed: boolean };
      };
    }>(
      await h.gql(
        `mutation Unlink($ref: ID!) {
           unlinkIssue(ref: $ref) {
             child { id parent { id } } previousParentId commit { pushed }
           }
         }`,
        { ref: child },
      ),
    ).unlinkIssue;

    assert.equal(result.previousParentId, parent);
    assert.equal(result.child.parent, null);
    assert.equal(result.commit.pushed, true);

    // Both sides: the parent stopped claiming it too.
    const old = ok<{ issue: { subtasks: unknown[] } }>(
      await h.gql(`query Q($ref: ID!) { issue(ref: $ref) { subtasks { id } } }`, { ref: parent }),
    );
    assert.deepEqual(old.issue.subtasks, []);
  });

  it("refuses to unlink an issue that is not a subtask", async () => {
    const lonely = await open("Lonely");
    assert.equal(
      errorCode(
        await h.gql(`mutation U($ref: ID!) { unlinkIssue(ref: $ref) { child { id } } }`, {
          ref: lonely,
        }),
      ),
      "PRECONDITION",
    );
  });
});
