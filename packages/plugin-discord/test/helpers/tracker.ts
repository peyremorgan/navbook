/**
 * Moving the tracker the two ways people do: over the API, as the web
 * tracker does, and from a terminal, as `nav` does before a push.
 */

import type { EntityKind } from "@navbook/core";
import * as core from "@navbook/core";
import { type Harness, ok } from "@navbook/server/test-helpers";

export async function openIssue(
  h: Harness,
  title: string,
  more: { assignees?: string[]; body?: string } = {},
  token?: string,
): Promise<string> {
  const result = ok(
    await h.gql<{ openIssue: { issue: { id: string } } }>(
      `mutation Open($input: OpenIssueInput!) { openIssue(input: $input) { issue { id } } }`,
      {
        input: {
          title,
          body: more.body ?? "It does not work.",
          ...(more.assignees ? { assignees: more.assignees } : {}),
        },
      },
      token,
    ),
  );
  return result.openIssue.issue.id;
}

export async function comment(
  h: Harness,
  kind: "ISSUE" | "PR",
  ref: string,
  body: string,
): Promise<void> {
  ok(
    await h.gql(
      `mutation C($input: AddCommentInput!) { addComment(input: $input) { comment { id } } }`,
      { input: { kind, ref, body } },
    ),
  );
}

export async function updateIssue(
  h: Harness,
  ref: string,
  fields: Record<string, unknown>,
): Promise<void> {
  ok(
    await h.gql(
      `mutation U($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }`,
      { input: { ref, ...fields } },
    ),
  );
}

export async function closeIssue(h: Harness, ref: string, resolution?: string): Promise<void> {
  ok(
    await h.gql(
      `mutation X($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }`,
      { input: { ref, ...(resolution === undefined ? {} : { resolution }) } },
    ),
  );
}

export async function reopenIssue(h: Harness, ref: string): Promise<void> {
  ok(await h.gql(`mutation R($ref: ID!) { reopenIssue(ref: $ref) { issue { id } } }`, { ref }));
}

/** A clone's workspace, as `nav` would make it there. */
function wsOf(h: Harness, dir: string): core.WsCtx {
  return core.makeWsCtx({ cwd: dir, env: h.fixture.env });
}

/** Bring the peer up to date with origin's `branch`, so its push is a fast-forward. */
export function peerPull(h: Harness, branch = "main"): void {
  const { peer } = h.fixture;
  peer.git(["checkout", "--quiet", branch]);
  const pulled = peer.git(["pull", "--quiet", "--no-rebase", "origin", branch]);
  if (pulled.code !== 0) throw new Error(`peer pull failed: ${pulled.stderr}`);
}

function peerPush(h: Harness, branch: string): void {
  const pushed = h.fixture.peer.git(["push", "--quiet", "origin", branch]);
  if (pushed.code !== 0) throw new Error(`peer push failed: ${pushed.stderr}`);
}

/** A comment, or a review, written at a terminal on `branch` and pushed. */
export function peerComment(
  h: Harness,
  kind: EntityKind,
  ref: string,
  body: string,
  opts: { branch?: string; author?: string; verdict?: string; revision?: string } = {},
): void {
  const branch = opts.branch ?? "main";
  peerPull(h, branch);
  const ws = wsOf(h, h.fixture.peer.dir);
  const entity = core.findEntity(ws, kind, ref);
  const content = core.newCommentFile({
    author: opts.author ?? "Peer Person <peer@example.com>",
    body,
    ...(opts.verdict === undefined ? {} : { verdict: opts.verdict, revision: opts.revision }),
  } as Parameters<typeof core.newCommentFile>[0]);
  core.applyComment(ws, entity, { content }, { commit: true });
  peerPush(h, branch);
  h.fixture.peer.git(["checkout", "--quiet", "main"]);
}

/** Rewrite a file at a terminal on `branch`, commit it and push. */
export function peerEdit(
  h: Harness,
  path: string,
  edit: (text: string) => string,
  opts: { branch?: string; message?: string } = {},
): void {
  const branch = opts.branch ?? "main";
  peerPull(h, branch);
  const { peer } = h.fixture;
  const text = peer.git(["show", `HEAD:${path}`]).stdout;
  peer.write(path, edit(text));
  peer.commitAll(opts.message ?? `docs: edit ${path}`);
  peerPush(h, branch);
  peer.git(["checkout", "--quiet", "main"]);
}

/** Merge `branch` into main at a terminal, filing its pull request as merged, and push. */
export function peerMerge(h: Harness, branch: string, id: string): void {
  peerPull(h, "main");
  const { peer } = h.fixture;
  peer.git(["fetch", "--quiet", "origin"]);
  const merged = peer.git([
    "merge",
    "--quiet",
    "--no-ff",
    "-m",
    `Merge ${branch}`,
    `origin/${branch}`,
  ]);
  if (merged.code !== 0) throw new Error(`peer merge failed: ${merged.stderr}`);
  const dir = peer
    .git(["ls-tree", "--name-only", "HEAD", ".navbook/prs/open/"])
    .stdout.split("\n")
    .find((line) => line.includes(id));
  if (dir === undefined) throw new Error(`no open pull request ${id} on main after the merge`);
  const moved = peer.git(["mv", dir, dir.replace("/prs/open/", "/prs/merged/")]);
  if (moved.code !== 0) throw new Error(`peer move failed: ${moved.stderr}`);
  peer.commitAll(`docs(pr): merge #${id}`);
  peerPush(h, "main");
}

/** Delete a branch on origin, as somebody abandoning their work would. */
export function peerDropBranch(h: Harness, branch: string): void {
  const dropped = h.fixture.peer.git(["push", "--quiet", "origin", "--delete", branch]);
  if (dropped.code !== 0) throw new Error(`peer delete failed: ${dropped.stderr}`);
}

/** Where a record's main file is on origin's `branch`, as the peer finds it after a fetch. */
export function recordPath(h: Harness, id: string, branch = "main"): string {
  const { peer } = h.fixture;
  peer.git(["fetch", "--quiet", "origin"]);
  const path = peer
    .git(["ls-tree", "-r", "--name-only", `origin/${branch}`, ".navbook/"])
    .stdout.split("\n")
    .find((each) => each.includes(`/${id}-`) && /\/(issue|pr)\.md$/.test(each));
  if (path === undefined) throw new Error(`#${id} is not on origin/${branch}`);
  return path;
}
