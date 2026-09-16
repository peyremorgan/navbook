import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blobSha } from "../src/index.ts";

describe("blobSha", () => {
  // The two hashes everybody who has looked at a git object store knows.
  it("names the empty blob as git does", () => {
    assert.equal(blobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("names a one-line file as git does, counting bytes rather than characters", () => {
    assert.equal(blobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
    // "é" is two bytes; a count of characters would hash a different header.
    assert.notEqual(blobSha("é"), blobSha("e"));
    assert.match(blobSha("é"), /^[0-9a-f]{40}$/);
  });
});
