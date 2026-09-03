/**
 * Rendering the Markdown that Navbook stores, safely.
 *
 * An issue body and a comment body are Markdown on disk and are shown as
 * Markdown here — but they arrive from a repository anyone with a checkout can
 * write to, so they are untrusted input in the ordinary sense. markdown-it
 * renders, DOMPurify decides what survives, and nothing reaches the DOM
 * without passing through both.
 *
 * This is the one place in the client that produces HTML from data. Keeping it
 * one place is what makes the rule checkable: `v-html` appears in
 * `MarkdownBody.vue` and nowhere else.
 */

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

/**
 * Links leave the app, so they open away from it and cannot reach back.
 *
 * `noopener` is the part that matters: without it a rendered link hands the
 * page it opens a handle on this one.
 */
renderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  token?.attrSet("target", "_blank");
  token?.attrSet("rel", "noopener noreferrer nofollow");
  return self.renderToken(tokens, index, options);
};

/**
 * DOMPurify runs in a browser, and the tests run in one too (happy-dom), but
 * nothing here should render on a server. Guarding keeps the failure legible
 * if that ever changes.
 */
function sanitize(html: string): string {
  if (typeof window === "undefined") {
    throw new Error("markdown rendering needs a DOM; this client does not render on a server");
  }
  return DOMPurify.sanitize(html, {
    // A body may only ever be a document. Anything that loads, executes or
    // collects — script, iframe, form, style — has no place in one.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset", "formaction", "form"],
    ALLOW_DATA_ATTR: false,
  });
}

/** A Markdown body as HTML fit to insert. */
export function renderMarkdown(source: string): string {
  return sanitize(renderer.render(source));
}

/** A single line of Markdown — a title, a table cell — as inline HTML. */
export function renderMarkdownInline(source: string): string {
  return sanitize(renderer.renderInline(source));
}
