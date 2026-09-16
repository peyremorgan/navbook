/**
 * Reading what the server said.
 *
 * Two of these failures are questions with a dialog behind them, and the
 * information the dialog needs is in `extensions`. Getting it out is worth
 * testing against the shapes the server actually sends — the fixtures below are
 * copied from `packages/server/src/errors.ts`, `sync.ts` and
 * `resolvers/mutation.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  describeApiError,
  errorHeading,
  isForbidden,
  isUnauthenticated,
  reparentConflict,
  staleEdit,
  unservedBranch,
} from "../../app/utils/errors";

/** What Apollo throws for a GraphQL failure. */
function apolloError(message: string, extensions: Record<string, unknown>): unknown {
  return {
    name: "ApolloError",
    message,
    graphQLErrors: [{ message, extensions }],
    networkError: null,
  };
}

describe("describeApiError", () => {
  it("reads the code, the message and the details", () => {
    const failure = describeApiError(
      apolloError("#ab12 is not in this tree", {
        code: "NOT_FOUND",
        details: ["check the id", "or the branch"],
      }),
    );
    assert.equal(failure.code, "NOT_FOUND");
    assert.equal(failure.message, "#ab12 is not in this tree");
    assert.deepEqual(failure.details, ["check the id", "or the branch"]);
  });

  it("copes with an error carrying no details", () => {
    const failure = describeApiError(apolloError("nope", { code: "INVALID_INPUT" }));
    assert.deepEqual(failure.details, []);
  });

  it("ignores details that are not strings", () => {
    const failure = describeApiError(apolloError("nope", { code: "X", details: [1, "a", null] }));
    assert.deepEqual(failure.details, ["a"]);
  });

  it("reports a transport failure as one, with no code", () => {
    const failure = describeApiError({
      message: "Failed to fetch",
      graphQLErrors: [],
      networkError: { message: "Failed to fetch" },
    });
    assert.equal(failure.code, null);
    assert.equal(failure.message, "Failed to fetch");
  });

  it("reads a bare GraphQL error, not only an Apollo wrapper", () => {
    const failure = describeApiError({ message: "boom", extensions: { code: "GIT_ERROR" } });
    assert.equal(failure.code, "GIT_ERROR");
  });

  it("says something useful about anything at all", () => {
    assert.equal(describeApiError(new Error("plain")).code, null);
    assert.equal(describeApiError(new Error("plain")).message, "plain");
    assert.equal(describeApiError("a string").code, null);
    assert.equal(describeApiError(null).code, null);
    assert.equal(describeApiError(undefined).code, null);
  });

  it("takes the first error when several came back", () => {
    const failure = describeApiError({
      graphQLErrors: [
        { message: "first", extensions: { code: "NOT_FOUND" } },
        { message: "second", extensions: { code: "AMBIGUOUS" } },
      ],
    });
    assert.equal(failure.code, "NOT_FOUND");
  });
});

describe("errorHeading", () => {
  it("names every code the API documents", () => {
    // Not an exhaustive list of the core's codes — the point is that the ones
    // a person will actually provoke read as sentences, not as constants.
    for (const [code, expected] of [
      ["NOT_FOUND", "Not found"],
      ["AMBIGUOUS", "That prefix matches more than one"],
      ["REPARENT_REQUIRED", "It already has a parent"],
      ["SYNC_CONFLICT", "The server's clone conflicts with the remote"],
      ["SYNC_PUSH_REJECTED", "The remote refused the push"],
      ["UNAUTHENTICATED", "Not signed in"],
      ["FORBIDDEN", "Not allowed on this repository"],
      ["GIT_ERROR", "A git command failed on the server"],
    ] as const) {
      assert.equal(errorHeading(code), expected);
    }
  });

  it("has something to say about a code it has never seen", () => {
    assert.equal(errorHeading("SOMETHING_NEW"), "The operation failed");
  });

  it("distinguishes not reaching the server from being refused by it", () => {
    assert.equal(errorHeading(null), "The server could not be reached");
  });
});

describe("isUnauthenticated", () => {
  it("is the code the server sends with its 401", () => {
    assert.equal(
      isUnauthenticated(describeApiError(apolloError("no", { code: "UNAUTHENTICATED" }))),
      true,
    );
    assert.equal(
      isUnauthenticated(describeApiError(apolloError("no", { code: "NOT_FOUND" }))),
      false,
    );
    assert.equal(isUnauthenticated(describeApiError(new Error("offline"))), false);
  });
});

describe("isForbidden", () => {
  it("is the code the server sends with its 403, and not the 401's", () => {
    assert.equal(isForbidden(describeApiError(apolloError("no", { code: "FORBIDDEN" }))), true);
    assert.equal(
      isForbidden(describeApiError(apolloError("no", { code: "UNAUTHENTICATED" }))),
      false,
    );
    // The two are kept apart on purpose: one means sign in, the other means
    // signing in would change nothing.
    assert.equal(
      isUnauthenticated(describeApiError(apolloError("no", { code: "FORBIDDEN" }))),
      false,
    );
  });
});

describe("reparentConflict", () => {
  it("reads the parent the refusal named", () => {
    const failure = describeApiError(
      apolloError("#aaaa0002 is already a subtask of #aaaa0001", {
        code: "REPARENT_REQUIRED",
        currentParentId: "aaaa0001",
        currentParentTitle: "Sign-in is unreliable",
        details: ["pass allowReparent: true to move it"],
      }),
    );
    assert.deepEqual(reparentConflict(failure), {
      currentParentId: "aaaa0001",
      currentParentTitle: "Sign-in is unreliable",
    });
  });

  it("copes when the parent is dangling and has no title", () => {
    // The server omits the title when the parent is not in this tree.
    const failure = describeApiError(
      apolloError("already a subtask", {
        code: "REPARENT_REQUIRED",
        currentParentId: "aaaa0001",
      }),
    );
    assert.deepEqual(reparentConflict(failure), {
      currentParentId: "aaaa0001",
      currentParentTitle: null,
    });
  });

  it("is null for anything else", () => {
    assert.equal(reparentConflict(describeApiError(apolloError("x", { code: "NOT_FOUND" }))), null);
    assert.equal(
      reparentConflict(describeApiError(apolloError("x", { code: "REPARENT_REQUIRED" }))),
      null,
      "without a parent id there is nothing to ask about",
    );
  });
});

describe("unservedBranch", () => {
  it("reads the branch a refused pull-request comment named", () => {
    const failure = describeApiError(
      apolloError(
        "#bbbb0002 is on 'origin/feat/unserved', which this server does not have checked out",
        {
          code: "PRECONDITION",
          sourceRef: "origin/feat/unserved",
          details: ["a comment must be written beside the pull request it belongs to"],
        },
      ),
    );
    assert.equal(unservedBranch(failure), "origin/feat/unserved");
  });

  it("is null for a precondition that is about something else", () => {
    assert.equal(
      unservedBranch(describeApiError(apolloError("x", { code: "PRECONDITION" }))),
      null,
    );
    assert.equal(unservedBranch(describeApiError(apolloError("x", { code: "NOT_FOUND" }))), null);
  });
});

describe("staleEdit", () => {
  it("reads the fields a refused edit was told had moved", () => {
    const failure = describeApiError(
      apolloError("title, milestone of #aaaa0001 changed since you opened it", {
        code: "STALE_CONTENT",
        moved: ["title", "milestone"],
        details: ["reload it and apply your change to what it says now"],
      }),
    );
    assert.deepEqual(staleEdit(failure), {
      message: "title, milestone of #aaaa0001 changed since you opened it",
      moved: ["title", "milestone"],
    });
  });

  it("reads a per-file refusal, which names no fields, as stale all the same", () => {
    const failure = describeApiError(
      apolloError("auth/login-flow.md changed since you opened it", { code: "STALE_CONTENT" }),
    );
    assert.deepEqual(staleEdit(failure)?.moved, []);
  });

  it("is null for any other failure", () => {
    assert.equal(staleEdit(describeApiError(apolloError("no", { code: "NOT_FOUND" }))), null);
    assert.equal(staleEdit(describeApiError(new Error("offline"))), null);
  });
});
