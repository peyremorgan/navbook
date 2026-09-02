/**
 * The write half, over HTTP.
 *
 * A mutation is only done when the change is in the clone's history *and* on
 * the remote, so most of these assert on three things: what the payload said,
 * what the file now holds, and what origin received.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";
import { originSubjects } from "../helpers/temprepo.ts";

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) {
    issue { id title body labels assignees milestone status path }
    parent { id }
    commit { committed subject pushed }
  }
}`;

interface OpenResult {
  openIssue: {
    issue: {
      id: string;
      title: string;
      body: string;
      labels: string[];
      assignees: string[];
      milestone: string | null;
      status: string;
      path: string;
    };
    parent: { id: string } | null;
    commit: { committed: boolean; subject: string; pushed: boolean };
  };
}

describe("writes", () => {
  let h: Harness;

  /** The text of an entity file in the server's clone. */
  const fileOf = (path: string): string => readFileSync(join(h.fixture.server.dir, path), "utf8");

  const open = async (input: Record<string, unknown>): Promise<OpenResult["openIssue"]> =>
    ok<OpenResult>(await h.gql(OPEN, { input })).openIssue;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("opens an issue, commits it, and pushes it to origin", async () => {
    const result = await open({ title: "Needs a fix", body: "Badly." });

    assert.equal(result.issue.title, "Needs a fix");
    assert.equal(result.issue.body, "Badly.");
    assert.equal(result.issue.status, "OPEN");
    assert.equal(result.commit.committed, true);
    assert.equal(result.commit.pushed, true);
    assert.equal(result.commit.subject, `docs(issue): open #${result.issue.id}`);

    // The file says what the payload said.
    const text = fileOf(`${result.issue.path}/issue.md`);
    assert.match(text, /^title: Needs a fix$/m);
    assert.match(text, /^author: A Person <person@example\.invalid>$/m);

    // And origin received exactly that commit.
    assert.equal(originSubjects(h.fixture.origin)[0], `docs(issue): open #${result.issue.id}`);
  });

  it("records the person as author and the machine as committer (spec 06 §6.2)", async () => {
    const result = await open({ title: "Attribution", body: "Who wrote this." });

    const text = fileOf(`${result.issue.path}/issue.md`);
    assert.match(text, /^author: A Person <person@example\.invalid>$/m);

    const committer = h.fixture.server.git(["log", "-1", "--format=%cn <%ce>"]).stdout.trim();
    assert.equal(committer, "Nav Server <server@test.invalid>");
  });

  it("carries a second signed-in person's identity into their own issue", async () => {
    const other = await h.token({ name: "Someone Else", email: "else@example.invalid" });
    const result = ok<OpenResult>(
      await h.gql(OPEN, { input: { title: "Theirs", body: "Mine." } }, other),
    ).openIssue;

    assert.match(
      fileOf(`${result.issue.path}/issue.md`),
      /^author: Someone Else <else@example\.invalid>$/m,
    );
  });

  it("writes the optional metadata it was given", async () => {
    const result = await open({
      title: "With metadata",
      body: "Tagged.",
      labels: ["bug", "ui"],
      assignees: ["A <a@example.invalid>", "B <b@example.invalid>"],
      milestone: "v2",
    });

    assert.deepEqual(result.issue.labels, ["bug", "ui"]);
    assert.deepEqual(result.issue.assignees, ["A <a@example.invalid>", "B <b@example.invalid>"]);
    assert.equal(result.issue.milestone, "v2");
    // Flow style, as the spec's own examples use.
    assert.match(fileOf(`${result.issue.path}/issue.md`), /^labels: \[bug, ui\]$/m);
  });

  it("refuses an empty title or body before anything is written", async () => {
    assert.equal(
      errorCode(await h.gql(OPEN, { input: { title: "   ", body: "x" } })),
      "INVALID_INPUT",
    );
    assert.equal(
      errorCode(await h.gql(OPEN, { input: { title: "x", body: "  \n " } })),
      "INVALID_INPUT",
    );
  });

  it("files an issue under a parent, in one commit, and links both ways", async () => {
    const parent = await open({ title: "Epic", body: "Big." });
    const child = await open({ title: "Step one", body: "Small.", parent: parent.issue.id });

    assert.equal(child.parent?.id, parent.issue.id);
    assert.match(
      fileOf(`${child.issue.path}/issue.md`),
      new RegExp(`^parent: ${parent.issue.id}$`, "m"),
    );
    // The parent's side landed in the same commit, so the tree is never
    // momentarily half-linked.
    assert.match(
      fileOf(`${parent.issue.path}/issue.md`),
      new RegExp(`^subtasks: \\[${child.issue.id}\\]$`, "m"),
    );
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout.trim(), "");
  });

  it("reports a parent that does not exist", async () => {
    assert.equal(
      errorCode(await h.gql(OPEN, { input: { title: "x", body: "y", parent: "zzzzzzzz" } })),
      "NOT_FOUND",
    );
  });

  it("closes an issue with a resolution and reopens it", async () => {
    const issue = await open({ title: "Transient", body: "Will close." });

    const closed = ok<{
      closeIssue: {
        issue: { id: string; status: string; resolution: string; path: string };
        destination: string;
        commit: { pushed: boolean };
      };
    }>(
      await h.gql(
        `mutation Close($ref: ID!) {
           closeIssue(input: { ref: $ref, resolution: "fixed" }) {
             issue { id status resolution path } destination commit { pushed }
           }
         }`,
        { ref: issue.issue.id },
      ),
    ).closeIssue;

    // The payload describes the tree as it now is, not as the operation found it.
    assert.equal(closed.issue.status, "CLOSED");
    assert.equal(closed.issue.resolution, "fixed");
    assert.equal(closed.destination, `issues/closed/${issue.issue.id}-transient`);
    assert.equal(closed.issue.path, `.navbook/issues/closed/${issue.issue.id}-transient`);
    assert.equal(closed.commit.pushed, true);

    const reopened = ok<{
      reopenIssue: { issue: { status: string; resolution: string | null }; destination: string };
    }>(
      await h.gql(
        `mutation Reopen($ref: ID!) {
           reopenIssue(ref: $ref) { issue { status resolution } destination }
         }`,
        { ref: issue.issue.id },
      ),
    ).reopenIssue;

    assert.equal(reopened.issue.status, "OPEN");
    // Reopening clears the resolution rather than leaving a stale one.
    assert.equal(reopened.issue.resolution, null);
  });

  it("records a duplicate, and refuses one of itself", async () => {
    const original = await open({ title: "Original", body: "First." });
    const copy = await open({ title: "Copy", body: "Second." });

    const closed = ok<{ closeIssue: { issue: { duplicateOf: string; resolution: string } } }>(
      await h.gql(
        `mutation Dup($ref: ID!, $of: ID!) {
           closeIssue(input: { ref: $ref, duplicateOf: $of }) {
             issue { duplicateOf resolution }
           }
         }`,
        { ref: copy.issue.id, of: original.issue.id },
      ),
    ).closeIssue;
    assert.equal(closed.issue.duplicateOf, original.issue.id);

    const self = await h.gql(
      `mutation Dup($ref: ID!) {
         closeIssue(input: { ref: $ref, duplicateOf: $ref }) { issue { id } }
       }`,
      { ref: original.issue.id },
    );
    assert.equal(errorCode(self), "PRECONDITION");
  });

  it("refuses to close an issue that is already closed", async () => {
    const issue = await open({ title: "Once", body: "Only." });
    const close = `mutation Close($ref: ID!) { closeIssue(input: { ref: $ref }) { issue { id } } }`;
    ok(await h.gql(close, { ref: issue.issue.id }));
    assert.equal(errorCode(await h.gql(close, { ref: issue.issue.id })), "PRECONDITION");
  });

  it("comments on an issue and reads the comment back", async () => {
    const issue = await open({ title: "Discussed", body: "Talk here." });

    const added = ok<{
      addComment: {
        comment: { id: string; author: string; body: string; path: string; verdict: string | null };
        entity: { id: string };
        commit: { subject: string; pushed: boolean };
      };
    }>(
      await h.gql(
        `mutation Comment($ref: ID!) {
           addComment(input: { kind: ISSUE, ref: $ref, body: "A thought." }) {
             comment { id author body path verdict }
             entity { id }
             commit { subject pushed }
           }
         }`,
        { ref: issue.issue.id },
      ),
    ).addComment;

    assert.equal(added.comment.author, "A Person <person@example.invalid>");
    assert.equal(added.comment.body, "A thought.");
    assert.equal(added.comment.verdict, null);
    assert.match(added.comment.path, /^\.navbook\/issues\/open\/.+\/comments\/.+\.md$/);
    assert.equal(added.commit.subject, `docs(issue): comment on #${issue.issue.id}`);
    assert.equal(added.commit.pushed, true);

    const shown = ok<{ issue: { comments: { id: string; body: string }[] } }>(
      await h.gql(`query Show($ref: ID!) { issue(ref: $ref) { comments { id body } } }`, {
        ref: issue.issue.id,
      }),
    );
    assert.deepEqual(shown.issue.comments, [{ id: added.comment.id, body: "A thought." }]);
  });

  it("replies to a comment by prefix", async () => {
    const issue = await open({ title: "Threaded", body: "Reply below." });
    const comment = `mutation C($ref: ID!, $body: String!, $replyTo: ID) {
      addComment(input: { kind: ISSUE, ref: $ref, body: $body, replyTo: $replyTo }) {
        comment { id replyTo }
      }
    }`;

    const first = ok<{ addComment: { comment: { id: string } } }>(
      await h.gql(comment, { ref: issue.issue.id, body: "First." }),
    ).addComment.comment;

    const second = ok<{ addComment: { comment: { replyTo: string } } }>(
      await h.gql(comment, {
        ref: issue.issue.id,
        body: "Second.",
        replyTo: first.id.slice(0, 4),
      }),
    ).addComment.comment;

    assert.equal(second.replyTo, first.id);
  });

  it("refuses review fields on an issue", async () => {
    const issue = await open({ title: "Not a PR", body: "No reviews here." });
    const response = await h.gql(
      `mutation R($ref: ID!) {
         addComment(input: { kind: ISSUE, ref: $ref, body: "x", verdict: APPROVE }) {
           comment { id }
         }
       }`,
      { ref: issue.issue.id },
    );
    assert.equal(errorCode(response), "INVALID_INPUT");
  });

  it("refuses a line without a file, and a revision without either", async () => {
    const issue = await open({ title: "Anchors", body: "Nowhere to point." });
    const send = (fields: string) =>
      h.gql(
        `mutation R($ref: ID!) {
           addComment(input: { kind: ISSUE, ref: $ref, body: "x", ${fields} }) { comment { id } }
         }`,
        { ref: issue.issue.id },
      );
    assert.equal(errorCode(await send(`line: "3"`)), "INVALID_INPUT");
    assert.equal(errorCode(await send(`revision: "abc"`)), "INVALID_INPUT");
  });
});
