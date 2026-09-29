import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDeletedIds, extractProseRefs, extractTrailerRefs } from "../src/core/refs.ts";

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

  it("ignores references anywhere inside inline code, not just at its start", () => {
    assert.deepEqual(extractProseRefs("run `nav pr show '#bqlybac0'` for #mz4kq1rv"), ["mz4kq1rv"]);
    assert.deepEqual(extractProseRefs("``a ` #bqlybac0`` and `x`#mz4kq1rv"), ["mz4kq1rv"]);
  });

  it("reads a backtick nobody closed as text", () => {
    assert.deepEqual(extractProseRefs("a stray ` then #mz4kq1rv"), ["mz4kq1rv"]);
    assert.deepEqual(extractProseRefs("``x` #mz4kq1rv"), ["mz4kq1rv"]);
  });

  it("does not let a code span run across paragraphs", () => {
    assert.deepEqual(extractProseRefs("a ` here\n\n#mz4kq1rv and ` there"), ["mz4kq1rv"]);
  });

  it("reads a long paragraph full of code spans in linear time", () => {
    // Untrusted input: a body that made the search for a span's end rescan
    // the paragraph from every backtick took seconds at this size.
    const lines = Array.from({ length: 20000 }, (_, i) => `line \`${i}\` and \`\` open #mz4kq1rv`);
    const started = performance.now();
    assert.deepEqual(extractProseRefs(lines.join("\n")), ["mz4kq1rv"]);
    assert.ok(performance.now() - started < 2000, "took too long");
  });

  it("ignores references inside a fenced code block", () => {
    const markdown = [
      "Before #mz4kq1rv.",
      "```",
      "41c8295 docs(issue): open #bqlybac0",
      "```",
      "After #dk3mp2x9.",
    ].join("\n");
    assert.deepEqual(extractProseRefs(markdown), ["mz4kq1rv", "dk3mp2x9"]);
  });

  it("reads tilde fences, info strings, and fences in list items and quotes", () => {
    assert.deepEqual(extractProseRefs("~~~text\n#bqlybac0\n~~~\n"), []);
    assert.deepEqual(extractProseRefs('```json\n{"id":"#bqlybac0"}\n```\n'), []);
    assert.deepEqual(extractProseRefs("- item\n\n  ```\n  #bqlybac0\n  ```\n"), []);
    assert.deepEqual(extractProseRefs("> ```\n> #bqlybac0\n> ```\n"), []);
  });

  it("closes a fence only on a run of its own character at least as long", () => {
    // A shorter run, the other character, or a run followed by text is content.
    const markdown = "````\n```\n~~~~\n```` x\n#bqlybac0\n````\nafter #mz4kq1rv";
    assert.deepEqual(extractProseRefs(markdown), ["mz4kq1rv"]);
  });

  it("runs a fence nobody closed to the end", () => {
    assert.deepEqual(extractProseRefs("see #mz4kq1rv\n```\n#bqlybac0\n"), ["mz4kq1rv"]);
  });

  it("does not take inline code with three backticks for a fence", () => {
    // A backtick fence's info string cannot hold a backtick (CommonMark §4.5).
    assert.deepEqual(extractProseRefs("```code``` then #mz4kq1rv\nand #bqlybac0"), [
      "mz4kq1rv",
      "bqlybac0",
    ]);
  });

  it("closes a fence only on a run indented as the fence's own container is", () => {
    // A run behind a list marker or a `>`, or indented four or more, is
    // content; taking it for the end would open a fence on the real one.
    for (const markdown of [
      "```md\n- item\n\n    ```\n    code\n    ```\n```\n\nprose #bbbb2222",
      "```md\n- ```js\n  code\n- ```\n```\n\nprose #bbbb2222",
      "```md\n> ```\n> code #aaaa1111\n```\n\nprose #bbbb2222",
    ]) {
      assert.deepEqual(extractProseRefs(markdown), ["bbbb2222"], markdown);
    }
  });

  it("opens no fence indented four columns or more, counting a tab as up to four", () => {
    assert.deepEqual(extractProseRefs("\t```\n#bbbb2222"), ["bbbb2222"]);
    assert.deepEqual(extractProseRefs("    ```\n#aaaa1111\n    ```\n#bbbb2222"), [
      "aaaa1111",
      "bbbb2222",
    ]);
  });

  it("ignores references inside an indented code block", () => {
    const log = "para\n\n    $ nav log\n    open #bqlybac0\n\nafter #mz4kq1rv";
    assert.deepEqual(extractProseRefs(log), ["mz4kq1rv"]);
    assert.deepEqual(extractProseRefs("- a\n\n      code #bqlybac0"), []);
    assert.deepEqual(extractProseRefs("# h\n    code #bqlybac0\n\n\tmore #mz4kq1rv"), []);
    // Indented text right after a paragraph line only carries the paragraph on.
    assert.deepEqual(extractProseRefs("para\n    still #mz4kq1rv"), ["mz4kq1rv"]);
  });

  it("reads list markers as markdown-it does", () => {
    // Only a list starting at 1 may interrupt a paragraph, so this is prose.
    assert.deepEqual(extractProseRefs("text\n2) ``` #q0000zzz"), ["q0000zzz"]);
    // A marker with nothing after it still opens an item.
    assert.deepEqual(extractProseRefs("1.\n   ```\n   #aaaa1111\n\n#bbbb2222"), ["bbbb2222"]);
    // A quote marker is not the indentation that keeps a line in a list item.
    assert.deepEqual(extractProseRefs("- ```\n  code\n\n>  #bbbb2222"), ["bbbb2222"]);
  });

  it("carries a paragraph on to a line that opens nothing, whatever it sits in", () => {
    assert.deepEqual(extractProseRefs("> a `b\nc #aaaa1111` d #bbbb2222"), ["bbbb2222"]);
    assert.deepEqual(extractProseRefs("- a `b\nc #aaaa1111` d #bbbb2222"), ["bbbb2222"]);
    // A list marker ends it all the same, even one that could not interrupt.
    assert.deepEqual(extractProseRefs("> a ` #aaaa1111\n2) b `"), ["aaaa1111"]);
  });

  it("ends a paragraph, and the code spans in it, at a rule or an underline", () => {
    assert.deepEqual(extractProseRefs("a `b\n***\n#bbbb2222 and `c`"), ["bbbb2222"]);
    assert.deepEqual(extractProseRefs("Use `foo\n===\nprose #bbbb2222 `x"), ["bbbb2222"]);
    assert.deepEqual(extractProseRefs("Use `foo\n---\nprose #bbbb2222 `x"), ["bbbb2222"]);
  });

  it("reads each cell of a table on its own, as markdown-it does", () => {
    // A code span cannot run from one cell, or one row, into the next.
    const table = "| cmd | ref |\n|---|---|\n| `a | #bbbb2222 |\n| b` | c |";
    assert.deepEqual(extractProseRefs(table), ["bbbb2222"]);
    // A cell past the head's columns is dropped, and never shown.
    assert.deepEqual(extractProseRefs("| a |\n|---|\n| b | #bbbb2222 |"), []);
    // A table interrupts a paragraph, and the span that paragraph opened.
    assert.deepEqual(extractProseRefs("para `x\n| a #bbbb2222 |\n| --- |\nb` c"), ["bbbb2222"]);
    // The next item of a list comes before a table.
    assert.deepEqual(extractProseRefs("- a\n- b \\| `\n--\n#bbbb2222 `"), []);
    // A lazy line can head one, ending the paragraph in the item above.
    assert.deepEqual(extractProseRefs("2) ` #aaaa1111\n|`\n\t-:"), ["aaaa1111"]);
  });

  it("does not take a run whose info string holds a backtick for a block", () => {
    assert.deepEqual(extractProseRefs("a `b\n```x` c #aaaa1111` d"), ["aaaa1111"]);
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

describe("extractDeletedIds", () => {
  it("reads the id out of a delete subject, for either kind", () => {
    assert.deepEqual(extractDeletedIds("docs(issue): delete #bqlybac0\n"), ["bqlybac0"]);
    assert.deepEqual(extractDeletedIds("docs(pr): delete #dk3mp2x9\n"), ["dk3mp2x9"]);
  });

  it("tolerates the leading newline git log leaves between messages", () => {
    assert.deepEqual(extractDeletedIds("\ndocs(issue): delete #bqlybac0\n"), ["bqlybac0"]);
  });

  it("ignores any other subject", () => {
    assert.deepEqual(extractDeletedIds("docs(issue): close #bqlybac0\n"), []);
    assert.deepEqual(extractDeletedIds("feat: delete #bqlybac0\n"), []);
    assert.deepEqual(extractDeletedIds("docs(issue): delete #bqlybac0 by hand\n"), []);
  });

  it("reads only the subject, never the body", () => {
    assert.deepEqual(extractDeletedIds("feat: cleanup\n\ndocs(issue): delete #bqlybac0\n"), []);
  });

  it("adds the subtasks a recursive delete removed with it", () => {
    assert.deepEqual(
      extractDeletedIds("docs(issue): delete #bqlybac0\n\nDeletes: mz4kq1rv\nDeletes: t5kr1gq6\n"),
      ["bqlybac0", "mz4kq1rv", "t5kr1gq6"],
    );
  });

  it("reads the trailer only from a commit that says it deleted something", () => {
    // Otherwise any commit could permanently silence a genuine D8 warning by
    // writing one line.
    assert.deepEqual(extractDeletedIds("feat: unrelated work\n\nDeletes: mz4kq1rv\n"), []);
  });

  it("does not mistake 'Deletes:' for a reference", () => {
    assert.deepEqual(extractTrailerRefs("docs(issue): delete #bqlybac0\n\nDeletes: mz4kq1rv\n"), {
      refs: [],
      closes: [],
    });
  });
});
