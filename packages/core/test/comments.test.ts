import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commentFileName, parseCommentFileName, threadOrder } from "../src/core/comments.ts";
import { fromCompactStamp, parseIso, toCompactStamp, toIsoSeconds } from "../src/core/time.ts";

describe("comment filenames", () => {
  it("builds the spec's example name", () => {
    const date = new Date("2026-08-03T14:12:07Z");
    assert.equal(commentFileName(date, "t5kr1gq6"), "2026-08-03T141207Z-t5kr1gq6.md");
  });

  it("contains no colons, so the name is valid on every filesystem", () => {
    const name = commentFileName(new Date("2026-08-03T14:12:07Z"), "t5kr1gq6");
    assert.ok(!name.includes(":"), name);
  });

  it("round-trips through the parser", () => {
    const date = new Date("2026-12-31T23:59:59Z");
    const name = commentFileName(date, "q8zm3vp1");
    const parsed = parseCommentFileName(name);
    assert.equal(parsed?.id, "q8zm3vp1");
    assert.equal(parsed?.date.toISOString(), date.toISOString());
  });

  it("drops sub-second precision rather than emitting an invalid name", () => {
    const name = commentFileName(new Date("2026-08-03T14:12:07.987Z"), "t5kr1gq6");
    assert.equal(name, "2026-08-03T141207Z-t5kr1gq6.md");
  });

  it("rejects names that violate the grammar", () => {
    const bad = [
      "2026-08-03T141207Z-t5kr1gq6.markdown",
      "2026-08-03T14:12:07Z-t5kr1gq6.md", // colons
      "2026-08-03T141207-t5kr1gq6.md", // no Z
      "2026-08-03T141207Z-feedback.md", // id has no digit
      "2026-08-03T141207Z-0bcdefg1.md", // id starts with a digit
      "20260803T141207Z-t5kr1gq6.md",
      "2026-08-03T141207Z.md",
      "issue.md",
    ];
    for (const name of bad) assert.equal(parseCommentFileName(name), null, name);
  });

  it("rejects timestamps that are not real instants", () => {
    for (const stamp of [
      "2026-13-03T141207Z",
      "2026-08-32T141207Z",
      "2026-08-03T251207Z",
      "2026-02-30T000000Z",
    ]) {
      assert.equal(parseCommentFileName(`${stamp}-t5kr1gq6.md`), null, stamp);
      assert.equal(fromCompactStamp(stamp), null, stamp);
    }
  });

  it("sorts chronologically as plain strings", () => {
    const names = [
      commentFileName(new Date("2026-08-04T09:30:12Z"), "aaaaaaa1"),
      commentFileName(new Date("2026-08-03T14:12:07Z"), "bbbbbbb2"),
      commentFileName(new Date("2026-01-01T00:00:00Z"), "ccccccc3"),
    ];
    assert.deepEqual([...names].sort(), [names[2], names[1], names[0]]);
  });
});

describe("time helpers", () => {
  it("formats ISO timestamps at second precision", () => {
    assert.equal(toIsoSeconds(new Date("2026-08-02T09:14:00.512Z")), "2026-08-02T09:14:00Z");
  });

  it("parses the timestamp shapes the spec allows", () => {
    for (const value of [
      "2026-08-02",
      "2026-08-02T09:14:00Z",
      "2026-08-02T09:14:00.512Z",
      "2026-08-02T09:14:00+02:00",
    ]) {
      assert.notEqual(parseIso(value), null, value);
    }
  });

  it("rejects non-timestamps", () => {
    for (const value of ["", "yesterday", "2026-13-01", "not a date", "08/02/2026"]) {
      assert.equal(parseIso(value), null, value);
    }
  });

  it("keeps compact stamps and ISO strings consistent", () => {
    const date = new Date("2026-08-03T14:12:07Z");
    assert.equal(fromCompactStamp(toCompactStamp(date))?.getTime(), date.getTime());
  });
});

interface Fake {
  id: string;
  fileName: string;
  replyTo?: string;
}

const comment = (id: string, minute: number, replyTo?: string): Fake => ({
  id,
  fileName: commentFileName(new Date(Date.UTC(2026, 7, 3, 12, minute, 0)), id),
  ...(replyTo ? { replyTo } : {}),
});

describe("threadOrder", () => {
  it("orders top-level comments chronologically", () => {
    const items = threadOrder([comment("bbbbbbb2", 30), comment("aaaaaaa1", 10)]);
    assert.deepEqual(
      items.map((i) => i.comment.id),
      ["aaaaaaa1", "bbbbbbb2"],
    );
    assert.deepEqual(
      items.map((i) => i.depth),
      [0, 0],
    );
  });

  it("places replies under their parent and indents them", () => {
    const items = threadOrder([
      comment("aaaaaaa1", 10),
      comment("bbbbbbb2", 20),
      comment("ccccccc3", 30, "aaaaaaa1"),
      comment("ddddddd4", 40, "ccccccc3"),
    ]);
    assert.deepEqual(
      items.map((i) => [i.comment.id, i.depth]),
      [
        ["aaaaaaa1", 0],
        ["ccccccc3", 1],
        ["ddddddd4", 2],
        ["bbbbbbb2", 0],
      ],
    );
  });

  it("keeps replies to unknown comments visible at top level", () => {
    const items = threadOrder([comment("aaaaaaa1", 10, "zzzzzzz9")]);
    assert.deepEqual(
      items.map((i) => [i.comment.id, i.depth]),
      [["aaaaaaa1", 0]],
    );
  });

  it("does not lose comments to a reply cycle", () => {
    const items = threadOrder([
      comment("aaaaaaa1", 10, "bbbbbbb2"),
      comment("bbbbbbb2", 20, "aaaaaaa1"),
    ]);
    assert.equal(items.length, 2);
  });

  it("does not lose a comment that replies to itself", () => {
    const items = threadOrder([comment("aaaaaaa1", 10, "aaaaaaa1")]);
    assert.deepEqual(
      items.map((i) => [i.comment.id, i.depth]),
      [["aaaaaaa1", 0]],
    );
  });

  it("returns nothing for an empty thread", () => {
    assert.deepEqual(threadOrder([]), []);
  });
});
