/**
 * Serving a repository whose Navbook directory is not called `.navbook`.
 *
 * The server builds a fresh workspace context per request, and two field
 * resolvers report a repository-relative `path`. Both had the directory's name
 * baked in until it became configurable, and neither would fail to typecheck
 * if it were baked in again — only a real request can show it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";
import { serverCommand } from "../helpers/temprepo.ts";

const NAV_ROOT = ".issues";

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id path } }
}`;

const COMMENT = `mutation Comment($input: AddCommentInput!) {
  addComment(input: $input) { comment { id path } }
}`;

const SHOW = `query Show($ref: ID!) {
  issue(ref: $ref) { id path comments { id path } }
}`;

describe("a renamed Navbook directory, over HTTP", () => {
  let h: Harness;
  let issue: string;

  before(async () => {
    h = await startHarness({ navRoot: NAV_ROOT });
    issue = ok<{ openIssue: { issue: { id: string } } }>(
      await h.gql(OPEN, {
        input: { title: "Renamed root", body: "Body." },
      }),
    ).openIssue.issue.id;
  });

  after(async () => {
    await h.stop();
  });

  it("starts against the renamed directory at all", () => {
    assert.ok(!h.stderr().includes("is not a Navbook repository"), h.stderr());
    assert.ok(existsSync(join(h.fixture.server.dir, NAV_ROOT)));
    assert.ok(!existsSync(join(h.fixture.server.dir, ".navbook")));
  });

  it("writes into the renamed directory", () => {
    assert.ok(existsSync(join(h.fixture.server.dir, NAV_ROOT, "issues", "open")));
  });

  it("reports an entity path under the configured name", async () => {
    const data = ok<{ issue: { path: string } }>(await h.gql(SHOW, { ref: issue }));
    assert.match(data.issue.path, /^\.issues\/issues\/open\//);
  });

  it("reports a comment path under the configured name", async () => {
    const added = ok<{ addComment: { comment: { path: string } } }>(
      await h.gql(COMMENT, {
        input: { kind: "ISSUE", ref: issue, body: "A remark." },
      }),
    );
    assert.match(added.addComment.comment.path, /^\.issues\/issues\/open\/.*\/comments\//);

    // And again on the read path, which is a different resolver.
    const data = ok<{ issue: { comments: { path: string }[] } }>(await h.gql(SHOW, { ref: issue }));
    assert.equal(data.issue.comments.length, 1);
    assert.match(data.issue.comments[0]?.path ?? "", /^\.issues\//);
  });

  it("never names the default directory in any response", async () => {
    const responses = [
      await h.gql(SHOW, { ref: issue }),
      await h.gql(`query { issues { id path } }`),
      await h.gql(`query { doctor { diagnostics { check level path message } } }`),
    ];
    for (const response of responses) {
      const body = JSON.stringify(response);
      assert.ok(!body.includes(".navbook"), `a response still names the default root:\n${body}`);
    }
  });

  it("does not report the marker as a tree problem", async () => {
    const data = ok<{ doctor: { diagnostics: { check: string; message: string }[] } }>(
      await h.gql(`query { doctor { diagnostics { check level path message } } }`),
    );
    assert.deepEqual(data.doctor.diagnostics, [], "the marker must not produce a diagnostic");
  });
});

describe("a server that cannot read the configured directory", () => {
  /**
   * Startup failure is tested with a plain synchronous spawn rather than the
   * harness: the harness owns a stub issuer it only closes on success, so a
   * server that refuses to start would leave it holding the event loop open.
   */
  const attempt = (dir: string, env: NodeJS.ProcessEnv): { status: number; stderr: string } => {
    const [command, ...leading] = serverCommand();
    const result = spawnSync(
      command as string,
      [
        ...leading,
        "--repo",
        dir,
        "--port",
        "0",
        "--oidc-issuer",
        "https://issuer.invalid",
        "--oidc-audience",
        "test",
        "--oidc-jwks-url",
        "https://issuer.invalid/jwks",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...env } },
    );
    return { status: result.status ?? 1, stderr: result.stderr ?? "" };
  };

  it("names the directory it was told to use, not the default", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-navroot-"));
    try {
      spawnSync("git", ["init", "--quiet", "-b", "main", dir]);
      const result = attempt(dir, { NAV_ROOT: ".issues" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /is not a Navbook repository \(no \.issues\/\)/);
      assert.ok(!result.stderr.includes(".navbook"), result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a NAV_ROOT that git would read as a pathspec", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-navroot-"));
    try {
      spawnSync("git", ["init", "--quiet", "-b", "main", dir]);
      const result = attempt(dir, { NAV_ROOT: "../escaped" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /NAV_ROOT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
