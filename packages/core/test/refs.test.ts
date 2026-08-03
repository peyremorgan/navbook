import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDeletedId, extractProseRefs, extractTrailerRefs } from "../src/core/refs.ts";

describe("extractProseRefs", () => {
  it("finds mid-line references", () => {
    assert.deepEqual(extractProseRefs("duplicate of #mz4kq1rv, see also #bqlybac0."), [
      "mz4kq1rv",
      "bqlybac0",
    ]);
  });

  it("ignores words that merely look like references", () => {
    assert.deepEqual(extractProseRefs("#feedback #hello #abcdefgh"), []);
  });

  it("ignores Markdown headings", () => {
    assert.deepEqual(extractProseRefs("# Heading\n## Another\n"), []);
  });

  it("still finds a line-initial reference, which Markdown renders literally", () => {
    // CommonMark only opens a heading when the '#' run is followed by a space,
    // so '#bqlybac0' at line start is ordinary text and a genuine reference.
    assert.deepEqual(extractProseRefs("#bqlybac0 at line start"), ["bqlybac0"]);
    assert.deepEqual(extractProseRefs("## bqlybac0 is a heading"), []);
  });

  it("ignores references inside inline code", () => {
    assert.deepEqual(extractProseRefs("use `#bqlybac0` verbatim"), []);
  });

  it("ignores fragments of URLs", () => {
    assert.deepEqual(extractProseRefs("https://example.com/page#bqlybac0"), []);
  });

  it("deduplicates repeated references", () => {
    assert.deepEqual(extractProseRefs("see #bqlybac0 and #bqlybac0 again"), ["bqlybac0"]);
  });

  it("requires the full eight characters", () => {
    assert.deepEqual(extractProseRefs("see #bqlyba and #bqlybac01"), []);
  });

  it("finds nothing in empty prose", () => {
    assert.deepEqual(extractProseRefs(""), []);
  });
});

describe("extractTrailerRefs", () => {
  it("reads the spec's trailer forms", () => {
    const message = "fix: raise LB idle timeout\n\nRefs: dk3mp2x9\nCloses: bqlybac0\n";
    assert.deepEqual(extractTrailerRefs(message), { refs: ["dk3mp2x9"], closes: ["bqlybac0"] });
  });

  it("accepts several ids on one trailer line", () => {
    const result = extractTrailerRefs("subject\n\nCloses: bqlybac0, mz4kq1rv\n");
    assert.deepEqual(result.closes, ["bqlybac0", "mz4kq1rv"]);
  });

  it("tolerates a leading # and odd spacing, and is case-insensitive on the key", () => {
    const result = extractTrailerRefs("subject\n\ncloses:   #bqlybac0\nREFS:\t#mz4kq1rv\n");
    assert.deepEqual(result, { refs: ["mz4kq1rv"], closes: ["bqlybac0"] });
  });

  it("ignores tokens that are not valid ids", () => {
    assert.deepEqual(extractTrailerRefs("subject\n\nCloses: feedback, #123\n"), {
      refs: [],
      closes: [],
    });
  });

  it("ignores other trailers", () => {
    const result = extractTrailerRefs("subject\n\nSigned-off-by: a@b.co\nCo-Authored-By: c@d.co\n");
    assert.deepEqual(result, { refs: [], closes: [] });
  });

  it("finds nothing in a message with no trailers", () => {
    assert.deepEqual(extractTrailerRefs("just a subject line\n"), { refs: [], closes: [] });
  });
});

describe("extractDeletedId", () => {
  it("reads the id out of a delete subject, for either kind", () => {
    assert.equal(extractDeletedId("docs(issue): delete #bqlybac0\n"), "bqlybac0");
    assert.equal(extractDeletedId("docs(pr): delete #dk3mp2x9\n"), "dk3mp2x9");
  });

  it("tolerates the leading newline git log leaves between messages", () => {
    assert.equal(extractDeletedId("\ndocs(issue): delete #bqlybac0\n"), "bqlybac0");
  });

  it("ignores any other subject", () => {
    assert.equal(extractDeletedId("docs(issue): close #bqlybac0\n"), null);
    assert.equal(extractDeletedId("feat: delete #bqlybac0\n"), null);
    assert.equal(extractDeletedId("docs(issue): delete #bqlybac0 by hand\n"), null);
  });

  it("reads only the subject, never the body", () => {
    assert.equal(extractDeletedId("feat: cleanup\n\ndocs(issue): delete #bqlybac0\n"), null);
  });
});
