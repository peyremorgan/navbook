/**
 * The one value in this client that comes back from outside and is then used
 * to navigate: the `state` the identity provider returns after signing in.
 *
 * A check for a leading slash would let `//example.invalid` through, which is
 * another host — and an open redirect inside a sign-in flow is exactly how a
 * phishing link gets to look convincing.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HOME, safeReturnPath } from "../../app/utils/navigation";

describe("safeReturnPath", () => {
  it("keeps a path within the app", () => {
    assert.equal(safeReturnPath("/issues"), "/issues");
    assert.equal(safeReturnPath("/issues/aaaa0001"), "/issues/aaaa0001");
    assert.equal(
      safeReturnPath("/issues?label=bug&status=closed"),
      "/issues?label=bug&status=closed",
    );
    assert.equal(safeReturnPath("/prs#discussion"), "/prs#discussion");
    assert.equal(safeReturnPath("  /issues  "), "/issues");
  });

  it("refuses anything that could name another origin", () => {
    for (const hostile of [
      "//example.invalid/",
      "//example.invalid",
      "/\\example.invalid",
      "https://example.invalid",
      "http://example.invalid",
      "javascript:alert(1)",
      "issues",
      "",
      "   ",
    ]) {
      assert.equal(safeReturnPath(hostile), HOME, hostile);
    }
  });

  it("refuses a path with whitespace or a control character in it", () => {
    // Parsers disagree about these, which is the whole problem with them: a
    // newline is where a second header goes, and a NUL is where a check stops
    // reading while something downstream keeps going.
    assert.equal(safeReturnPath("/prs\nhttps://example.invalid"), HOME);
    assert.equal(safeReturnPath("/prs\r\nLocation: https://example.invalid"), HOME);
    assert.equal(safeReturnPath("/\tprs"), HOME);
    assert.equal(safeReturnPath("/p rs"), HOME);
    assert.equal(safeReturnPath("/prs\u0000"), HOME);
    assert.equal(safeReturnPath("/p\u007frs"), HOME);
  });

  it("refuses anything that is not a string", () => {
    for (const wrong of [undefined, null, 42, {}, ["/issues"], true]) {
      assert.equal(safeReturnPath(wrong), HOME);
    }
  });

  it("uses the fallback it was given", () => {
    assert.equal(safeReturnPath("nonsense", "/prs"), "/prs");
  });
});
