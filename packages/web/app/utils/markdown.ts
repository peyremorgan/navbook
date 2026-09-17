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
 *
 * It is also where a `#id` written in prose becomes a link, which is the one
 * thing about the format that reaches the browser; `app/utils/references.ts`
 * holds the grammar and says why it is allowed to.
 */

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { safeReturnPath } from "~/utils/navigation";
import { findProseReferences, referencePath } from "~/utils/references";

const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

/**
 * `#t4mwvm2j` in prose becomes a link to whatever it names.
 *
 * A core rule rather than an inline one, for the same reason markdown-it's own
 * `linkify` is: it runs over the text that survived inline parsing, so a
 * reference inside a code span or a fence is not text by the time it gets here
 * and is left as written. The one thing left to check is links — a reference
 * inside one would nest an anchor in an anchor — which is what `depth` is for.
 *
 * Before `text_join` rather than after it, which is what makes `\#t4mwvm2j`
 * work. An escape and a numeric entity are `text_special` tokens until
 * `text_join` folds them into the text around them; after that they are
 * indistinguishable from a `#` somebody typed, and an author who went to the
 * trouble of escaping one would get a link anyway. Running first, the rule
 * only ever sees `text`, so an escaped reference is not one.
 *
 * Only `text` tokens are rewritten, and only when a reference is found in one,
 * so a body with none comes out of here as the same tokens it went in as.
 */
renderer.use((md: typeof renderer) => {
  md.core.ruler.before("text_join", "navbook_reference", (state) => {
    for (const block of state.tokens) {
      const children = block.children;
      if (block.type !== "inline" || children === null) continue;

      const rebuilt: typeof children = [];
      let depth = 0;
      let rewrote = false;

      for (const token of children) {
        if (token.type === "link_open") depth += 1;
        else if (token.type === "link_close") depth -= 1;
        if (token.type !== "text" || depth > 0) {
          rebuilt.push(token);
          continue;
        }

        const text = token.content;
        let level = token.level;
        let cursor = 0;

        for (const { id, start, end } of findProseReferences(text)) {
          if (start > cursor) {
            const lead = new state.Token("text", "", 0);
            lead.content = text.slice(cursor, start);
            lead.level = level;
            rebuilt.push(lead);
          }

          const open = new state.Token("link_open", "a", 1);
          open.attrSet("href", referencePath(id));
          open.attrSet("class", "nav-reference");
          open.markup = "reference";
          open.level = level;
          level += 1;

          const label = new state.Token("text", "", 0);
          label.content = `#${id}`;
          label.level = level;

          level -= 1;
          const close = new state.Token("link_close", "a", -1);
          close.markup = "reference";
          close.level = level;

          rebuilt.push(open, label, close);
          cursor = end;
        }

        if (cursor === 0) {
          rebuilt.push(token);
          continue;
        }
        if (cursor < text.length) {
          const tail = new state.Token("text", "", 0);
          tail.content = text.slice(cursor);
          tail.level = level;
          rebuilt.push(tail);
        }
        rewrote = true;
      }

      if (rewrote) block.children = rebuilt;
    }
  });
});

/**
 * Links that leave the app open away from it and cannot reach back.
 *
 * `noopener` is the part that matters: without it a rendered link hands the
 * page it opens a handle on this one.
 *
 * A link that stays in the app gets neither. Opening a new tab to move within
 * a tracker is not what anybody following a reference meant, and `nofollow`
 * describes a destination this app is not. `safeReturnPath` decides which is
 * which — it is the check the sign-in flow already trusts to tell a path in
 * this app from a URL somewhere else wearing a leading slash.
 */
renderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const href = token?.attrGet("href") ?? "";
  if (safeReturnPath(href, "") === "") {
    token?.attrSet("target", "_blank");
    token?.attrSet("rel", "noopener noreferrer nofollow");
  }
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
    // DOMPurify drops `target` by default, on the reasoning that a link
    // opening a new context is a tabnabbing risk. The rule above answers that
    // with `rel="noopener"`, so the attribute is put back rather than the
    // behaviour lost: a link out of the tracker should not replace the page
    // somebody was reading.
    ADD_ATTR: ["target"],
  });
}

/** A Markdown body as HTML fit to insert. */
export function renderMarkdown(source: string): string {
  return sanitize(renderer.render(source));
}

/**
 * A single line of Markdown — a title, a table cell — as inline HTML.
 *
 * References are linked here too, which is right for a line of prose and wrong
 * inside something that is already a link: an anchor within an anchor is not
 * markup a browser will keep. Nothing nests it today; a caller that wants to
 * should render the text without this.
 */
export function renderMarkdownInline(source: string): string {
  return sanitize(renderer.renderInline(source));
}
