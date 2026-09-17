// @vitest-environment node

/**
 * The client recognises `#id` references in prose so it can link them, and
 * that is the one thing about the format it is told (`app/utils/references.ts`
 * says why). Two readings of a format are how two implementations start to
 * disagree, so this holds the client's to the one `nav doctor` uses: whatever
 * the browser turns into a link is exactly what D8 counts as a reference.
 *
 * `@navbook/core` is a development dependency of this package, imported here
 * and nowhere in `app/` — the assertion runs in Node, not in the bundle.
 */

import assert from "node:assert/strict";
import { extractProseRefs } from "@navbook/core";
import { describe, it } from "vitest";
import { findProseReferences, referencePath } from "../../app/utils/references.ts";

/** Every id the client would link, in the order it would link them. */
function clientRefs(text: string): string[] {
  return findProseReferences(text).map((reference) => reference.id);
}

const PROSE = [
  "duplicate of #t4mwvm2j",
  "#t4mwvm2j opens the line",
  "superseded by #mdftn010, which #icroff4l also mentions",
  "no reference here at all",
  "#short and #TOOLOUD and #0digitfirst are not ids",
  "#abcdefghi is nine characters",
  // The format requires a digit precisely so that an eight-letter word is not
  // an id. Without this line both readings look alike and neither is checked.
  "#deadline and #reverted and #manifest are words, not ids",
  "an id needs a hash: t4mwvm2j",
  "a url fragment is not one: https://example.invalid/x#t4mwvm2j",
  "nor is a path: /issues/#t4mwvm2j",
  "nor a word ending in one: x#t4mwvm2j",
  "##t4mwvm2j is a heading marker, twice",
  "the same one twice: #t4mwvm2j and #t4mwvm2j",
  "punctuation after: (#t4mwvm2j), #mdftn010. #icroff4l!",
];

describe("the reference grammar", () => {
  it("finds what the format's own reader finds", () => {
    for (const text of PROSE) {
      // `extractProseRefs` answers with each id once; the client links every
      // occurrence, so the comparison is over the set.
      assert.deepEqual(
        [...new Set(clientRefs(text))].sort(),
        [...extractProseRefs(text)].sort(),
        text,
      );
    }
  });

  it("agrees about a whole document, not just a line", () => {
    const document = PROSE.join("\n\n");
    assert.deepEqual(
      [...new Set(clientRefs(document))].sort(),
      [...extractProseRefs(document)].sort(),
    );
    assert.ok(clientRefs(document).length > 0);
  });

  it("says where each one sits, hash included", () => {
    const text = "see #t4mwvm2j now";
    assert.deepEqual(findProseReferences(text), [{ id: "t4mwvm2j", start: 4, end: 13 }]);
    assert.equal(text.slice(4, 13), "#t4mwvm2j");
  });

  it("is not left holding a position between calls", () => {
    // A module-level regex with the global flag keeps `lastIndex`, and a
    // second reading that started in the middle of the first would be the
    // subtlest possible bug. `matchAll` is specified to work on a copy.
    const text = "see #t4mwvm2j";
    assert.deepEqual(clientRefs(text), ["t4mwvm2j"]);
    assert.deepEqual(clientRefs(text), ["t4mwvm2j"]);
  });
});

describe("referencePath", () => {
  it("names the route that asks which kind an id belongs to", () => {
    assert.equal(referencePath("t4mwvm2j"), "/ref/t4mwvm2j");
  });
});
