/**
 * The process stays answerable while git is out on the network.
 *
 * A push takes as long as the remote takes, and every operation queues behind
 * the one holding the clone — that is the design, and `concurrency.test.ts`
 * proves it holds. What must not queue is everything else: a request that
 * needs no tree, a token that is refused, the GraphiQL page, a health probe.
 * Before the git layer yielded, all of those waited the push out; these tests
 * are what would notice if any of them started to again.
 *
 * The remote is a bare origin whose `pre-receive` hook sleeps, which makes a
 * push hang exactly as one to a remote that accepts the connection and then
 * stops answering does.
 */

import assert from "node:assert/strict";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { errorCode, ok, startHarness } from "../helpers/harness.ts";
import { originSubjects } from "../helpers/temprepo.ts";

const OPEN = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "x" }) {
    issue { id title }
    commit { committed pushed }
  }
}`;

interface OpenResult {
  openIssue: {
    issue: { id: string; title: string };
    commit: { committed: boolean; pushed: boolean };
  };
}

/** Make the origin sit on every push for `seconds`, as an unreachable one would. */
function stallPushes(origin: string, seconds: number): () => void {
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\nsleep ${seconds}\nexit 0\n`, "utf8");
  chmodSync(hook, 0o755);
  return () => rmSync(hook, { force: true });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a request took, and what it answered. */
async function timed<T>(work: Promise<T>): Promise<{ ms: number; value: T }> {
  const started = Date.now();
  const value = await work;
  return { ms: Date.now() - started, value };
}

describe("a push in flight", () => {
  it("holds up the clone's queue and nothing else", async () => {
    const h = await startHarness({ pullIntervalMs: 0, graphiql: true });
    try {
      const unstall = stallPushes(h.fixture.origin, 3);
      const mutation = h.gql<OpenResult>(OPEN, { title: "Slow to land" });
      // Past the fetch and the commit, into the push.
      await sleep(400);

      const [page, refused, read] = await Promise.all([
        timed(fetch(`http://127.0.0.1:${h.port}/graphql`, { headers: { accept: "text/html" } })),
        timed(h.gql("{ __typename }", undefined, null)),
        timed(h.gql<{ issues: { title: string }[] }>("{ issues { title } }")),
      ]);

      // Neither of these touches the clone, and neither waited for it.
      assert.equal(page.value.status, 200);
      await page.value.text();
      assert.ok(page.ms < 1500, `the GraphiQL page waited ${page.ms} ms on a push`);
      assert.equal(refused.value.status, 401);
      assert.ok(refused.ms < 1500, `a refused token waited ${refused.ms} ms on a push`);

      // The read does touch the clone, so it queued — and ran after the
      // mutation, on the tree the mutation left: it sees the issue.
      const titles = ok(read.value).issues.map((issue) => issue.title);
      assert.ok(titles.includes("Slow to land"), titles.join(", "));

      const landed = ok(await mutation).openIssue;
      assert.equal(landed.commit.pushed, true);
      unstall();
    } finally {
      await h.stop();
    }
  });
});

describe("--git-timeout-ms", () => {
  it("stops a push that outlives it, keeps the commit, and carries it next time", async () => {
    const h = await startHarness({ pullIntervalMs: 0, gitTimeoutMs: 500 });
    try {
      const unstall = stallPushes(h.fixture.origin, 4);

      const stopped = await timed(h.gql(OPEN, { title: "Stopped" }));
      assert.equal(errorCode(stopped.value), "SYNC_FAILED");
      assert.equal(stopped.value.errors[0]?.extensions?.keptLocalCommit, true);
      assert.match(stopped.value.errors[0]?.message ?? "", /push did not finish within 500 ms/);
      assert.ok(stopped.ms < 3000, `a 500 ms timeout returned after ${stopped.ms} ms`);

      // Committed in the clone, with nothing left locked or half-done.
      const subject = h.fixture.server.git(["log", "-1", "--format=%s"]).stdout.trim();
      assert.match(subject, /^docs\(issue\): open #/);
      assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout.trim(), "");
      // And in the log, with what git was running.
      assert.match(h.stderr(), /git push .* did not finish within 500 ms and was stopped/);

      // Once the remote answers, the next mutation's push carries both.
      unstall();
      const next = ok<OpenResult>(await h.gql(OPEN, { title: "Next" })).openIssue;
      assert.equal(next.commit.pushed, true);
      const subjects = originSubjects(h.fixture.origin);
      assert.ok(subjects.includes(`docs(issue): open #${next.issue.id}`));
      assert.ok(subjects.includes(subject), `origin is missing the stopped push's commit`);
    } finally {
      await h.stop();
    }
  });
});

describe("stopping", () => {
  it("finishes a push in flight before exiting", async () => {
    const h = await startHarness({ pullIntervalMs: 0 });
    try {
      stallPushes(h.fixture.origin, 2);
      const mutation = h.gql<OpenResult>(OPEN, { title: "Landing as we stop" });
      await sleep(400);
      process.kill(h.pid, "SIGTERM");

      // Told to stop between the commit and the push, the server pushes first.
      const landed = ok(await mutation).openIssue;
      assert.equal(landed.commit.pushed, true);
      assert.equal(await h.exited, 0);
      assert.match(h.stderr(), /received SIGTERM, finishing in-flight work/);
      assert.ok(originSubjects(h.fixture.origin).includes(`docs(issue): open #${landed.issue.id}`));
    } finally {
      await h.stop();
    }
  });
});
