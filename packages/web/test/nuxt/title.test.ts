/**
 * Titles are what a browser history is made of, so what is worth proving is
 * that no page can end up called the bare application name by accident — an
 * absent subject, a blank one, or a title somebody wrapped across two lines in
 * a text file — and that the parts read narrowest first.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { entityTitle, pageTitle, TITLE_SUFFIX } from "../../app/utils/title";

describe("pageTitle", () => {
  it("names the application on its own when nothing else is known", () => {
    assert.equal(pageTitle(), TITLE_SUFFIX);
  });

  it("suffixes the application, so a history entry says whose it is", () => {
    assert.equal(pageTitle("Issues"), "Issues · Navbook");
  });

  it("reads narrowest first, because a narrow tab truncates from the right", () => {
    assert.equal(
      pageTitle("Login flow", "Authentication"),
      "Login flow — Authentication · Navbook",
    );
  });

  it("drops the parts a page has not got yet rather than naming them", () => {
    assert.equal(pageTitle(undefined, "Authentication"), "Authentication · Navbook");
    assert.equal(pageTitle("Login flow", null), "Login flow · Navbook");
    assert.equal(pageTitle(null, undefined), TITLE_SUFFIX);
  });

  it("treats a blank part as no part, not as an empty one", () => {
    assert.equal(pageTitle("   "), TITLE_SUFFIX);
    assert.equal(pageTitle("  Issues  "), "Issues · Navbook");
  });

  it("collapses the whitespace a hand-written frontmatter title may carry", () => {
    assert.equal(
      pageTitle("Login times out\non slow connections"),
      "Login times out on slow connections · Navbook",
    );
  });
});

describe("entityTitle", () => {
  it("leads with the reference, which is what people search for", () => {
    assert.equal(
      entityTitle("bqlybac0", "Login times out on slow connections"),
      "#bqlybac0 Login times out on slow connections · Navbook",
    );
  });

  it("names a page from the address alone, before its query has answered", () => {
    assert.equal(entityTitle("bqlybac0"), "#bqlybac0 · Navbook");
    assert.equal(entityTitle("bqlybac0", null), "#bqlybac0 · Navbook");
  });

  it("shortens a whole directory name to the prefix the rest of the client shows", () => {
    assert.equal(entityTitle("bqlybac0-login-timeout"), "#bqlybac0 · Navbook");
  });

  it("keeps a prefix shorter than an id as it was typed", () => {
    assert.equal(entityTitle("bqly"), "#bqly · Navbook");
  });

  it("falls back to the application when the route carried no reference", () => {
    assert.equal(entityTitle(""), TITLE_SUFFIX);
    assert.equal(entityTitle("  "), TITLE_SUFFIX);
  });
});
