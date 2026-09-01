/**
 * Turning what the operation layer raises into what a client is told.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitError, WorkspaceError, type WorkspaceErrorCode } from "@navbook/core";
import { GraphQLError } from "graphql";
import { extensionCode, translate, unauthenticated } from "../../src/errors.ts";

/** Every code `core` defines, so a new one cannot be added without a name. */
const ALL_CODES: WorkspaceErrorCode[] = [
  "not-a-git-repo",
  "not-a-navbook-repo",
  "already-exists",
  "prefix-too-short",
  "not-found",
  "ambiguous",
  "wrong-kind",
  "missing-path",
  "destination-exists",
  "invalid-input",
  "precondition",
  "unrelated-staged",
  "frontmatter",
  "merge-conflict",
  "merge-unresolved",
  "merge-ambiguous",
  "bad-env",
  "ids-exhausted",
  "mint-failed",
];

describe("error translation", () => {
  it("gives every workspace code a distinct SCREAMING_SNAKE name", () => {
    const names = ALL_CODES.map(extensionCode);
    assert.ok(
      names.every((name) => /^[A-Z][A-Z_]*$/.test(name)),
      names.join(", "),
    );
    assert.equal(new Set(names).size, ALL_CODES.length);
  });

  it("carries a workspace error's code and details into extensions", () => {
    const error = translate(
      new WorkspaceError("ambiguous", "'aa11' is ambiguous", ["  #aa111111", "  #aa112222"]),
    );
    assert.ok(error instanceof GraphQLError);
    assert.equal(error.message, "'aa11' is ambiguous");
    assert.equal(error.extensions.code, "AMBIGUOUS");
    assert.deepEqual(error.extensions.details, ["  #aa111111", "  #aa112222"]);
  });

  it("omits details when there are none, rather than sending an empty list", () => {
    const error = translate(new WorkspaceError("not-found", "no issue matches 'zz'"));
    assert.ok(error instanceof GraphQLError);
    assert.equal(error.extensions.details, undefined);
  });

  it("passes an error that already carries a code straight through", () => {
    const original = unauthenticated("the bearer token was not accepted");
    assert.equal(translate(original), original);
  });

  it("names a git failure as one", () => {
    const error = translate(
      new GitError(["push", "origin", "main"], { code: 128, stdout: "", stderr: "nope" }),
    );
    assert.ok(error instanceof GraphQLError);
    assert.equal(error.extensions.code, "GIT_ERROR");
  });

  it("leaves anything unrecognised alone, for Yoga to mask", () => {
    // An unexpected failure is a bug, and its message is not a client's business.
    const bug = new TypeError("cannot read properties of undefined");
    assert.equal(translate(bug), bug);
  });

  it("answers an unusable token with a 401", () => {
    const error = unauthenticated("a bearer token is required");
    assert.equal(error.extensions.code, "UNAUTHENTICATED");
    assert.deepEqual(error.extensions.http, { status: 401 });
  });
});
