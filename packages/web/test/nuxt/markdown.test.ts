// @vitest-environment jsdom

/**
 * Rendering is the one place this client turns data into HTML, and the data
 * comes from a repository anyone with a checkout can write to. So the suite is
 * mostly about what must not survive.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { renderMarkdown, renderMarkdownInline } from "../../app/utils/markdown";

describe("renderMarkdown", () => {
  it("renders the Markdown an issue body is written in", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and `code`.\n\n- one\n- two");
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it("renders fenced code without executing anything in it", () => {
    const html = renderMarkdown("```js\nalert(1)\n```");
    assert.match(html, /<pre><code/);
    assert.ok(!html.includes("<script"));
  });

  it("escapes raw HTML rather than rendering it", () => {
    // markdown-it is configured with `html: false`, so a tag written into a
    // body is text. That is the first defence and the one that decides the
    // shape of everything below: nothing an author writes becomes markup.
    const html = renderMarkdown("before\n\n<script>alert(1)</script>\n\nafter");
    assert.ok(!html.includes("<script"), html);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<p>before<\/p>/);
    assert.match(html, /<p>after<\/p>/);
  });

  it("leaves no element with an event handler on it", () => {
    for (const source of [
      '<img src="x" onerror="alert(1)">',
      '<div onclick="alert(1)">click</div>',
      '<a href="#" onmouseover="alert(1)">hover</a>',
    ]) {
      const html = renderMarkdown(source);
      assert.ok(
        !/<[a-z]+[^>]*\son[a-z]+=/i.test(html),
        `a live handler survived ${source}: ${html}`,
      );
    }
  });

  it("never emits a link that runs script", () => {
    for (const source of [
      "[click](javascript:alert(1))",
      "[click](JaVaScRiPt:alert(1))",
      "[click](data:text/html,<script>alert(1)</script>)",
    ]) {
      const html = renderMarkdown(source);
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "");
      for (const href of hrefs) {
        assert.ok(
          !/^\s*(javascript|data|vbscript):/i.test(href),
          `${source} produced href ${href}`,
        );
      }
    }
  });

  it("sends links away from the app, and cuts their handle on it", () => {
    const html = renderMarkdown("[docs](https://example.invalid)");
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
  });

  it("gives an autolinked address the same treatment", () => {
    const html = renderMarkdown("see https://example.invalid for more");
    assert.match(html, /<a[^>]*href="https:\/\/example.invalid"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
  });

  it("links a reference written in prose", () => {
    const html = renderMarkdown("Duplicate of #t4mwvm2j, probably.");
    assert.match(html, /<a href="\/ref\/t4mwvm2j" class="nav-reference">#t4mwvm2j<\/a>/);
    assert.match(html, /^<p>Duplicate of <a /);
    assert.match(html, /<\/a>, probably\.<\/p>/);
  });

  it("keeps a reference in the app rather than opening a tab away from it", () => {
    const html = renderMarkdown("see #t4mwvm2j");
    assert.ok(!html.includes("_blank"), html);
    assert.ok(!html.includes("nofollow"), html);
  });

  it("links every reference in a body, wherever it sits", () => {
    const html = renderMarkdown("#t4mwvm2j opens it; #mdftn010 and #icroff4l follow.");
    for (const id of ["t4mwvm2j", "mdftn010", "icroff4l"]) {
      assert.match(html, new RegExp(`href="/ref/${id}"`), html);
    }
  });

  it("leaves alone what the format does not call a reference", () => {
    for (const source of [
      "`#t4mwvm2j` in a code span",
      "```\n#t4mwvm2j in a fence\n```",
      "a fragment: https://example.invalid/page#t4mwvm2j",
      "#short, #TOOLOUD, #0digitfirst",
      // Eight letters and no digit: a word, which is what the digit in the
      // grammar is for (spec 02 §2.2).
      "#deadline is a word, not an id",
    ]) {
      assert.ok(!renderMarkdown(source).includes("/ref/"), source);
    }
  });

  it("never puts a link inside a link", () => {
    const html = renderMarkdown("[see #t4mwvm2j](https://example.invalid)");
    assert.ok(!html.includes("/ref/"), html);
    assert.equal(html.match(/<a /g)?.length, 1, html);
  });

  it("does not send a hand-written in-app link away either", () => {
    const html = renderMarkdown("[the listing](/issues?status=open)");
    assert.match(html, /href="\/issues\?status=open"/);
    assert.ok(!html.includes("_blank"), html);
  });

  it("escapes text that looks like markup", () => {
    const html = renderMarkdown("compare `a < b` and a <b> tag");
    assert.match(html, /a &lt; b/);
  });

  it("renders nothing for nothing", () => {
    assert.equal(renderMarkdown(""), "");
  });
});

describe("renderMarkdownInline", () => {
  it("leaves out the paragraph a block render would add", () => {
    const html = renderMarkdownInline("a **title**");
    assert.equal(html, "a <strong>title</strong>");
  });

  it("sanitises as thoroughly as the block renderer", () => {
    assert.ok(!renderMarkdownInline("<script>alert(1)</script>").includes("<script"));
  });
});
