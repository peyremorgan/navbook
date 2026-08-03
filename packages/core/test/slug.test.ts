import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIR_NAME_PATTERN,
  dirName,
  MAX_SLUG_LENGTH,
  parseDirName,
  SLUG_FALLBACK,
  slugify,
} from "../src/core/slug.ts";

describe("slugify", () => {
  it("derives the spec's example slug", () => {
    assert.equal(
      slugify("Login times out on slow connections"),
      "login-times-out-on-slow-connections",
    );
  });

  it("collapses runs of non-alphanumerics to one hyphen and trims the ends", () => {
    assert.equal(slugify("  --Hello,   World!!  "), "hello-world");
    assert.equal(slugify("a/b\\c:d"), "a-b-c-d");
  });

  it("folds accents to their ASCII base letters", () => {
    assert.equal(slugify("Café crash — été"), "cafe-crash-ete");
    assert.equal(slugify("Ünïcödé"), "unicode");
  });

  it("falls back to a valid segment when nothing survives folding", () => {
    for (const title of ["日本語のタイトル", "🎉🎉🎉", "---", "!!!", "   ", "…"]) {
      assert.equal(slugify(title), SLUG_FALLBACK, JSON.stringify(title));
    }
  });

  it("caps the slug and never ends it with a hyphen", () => {
    const slug = slugify(`${"word ".repeat(40)}end`);
    assert.ok(slug.length <= MAX_SLUG_LENGTH, `${slug.length} <= ${MAX_SLUG_LENGTH}`);
    assert.ok(!slug.endsWith("-"), slug);
  });

  it("always produces something a directory name accepts", () => {
    const titles = [
      "Login times out",
      "Café crash — été",
      "日本語",
      "-".repeat(80),
      `${"x".repeat(49)}-y`,
      "a".repeat(200),
      "1234",
      "___",
    ];
    for (const title of titles) {
      assert.match(dirName("bqlybac0", slugify(title)), DIR_NAME_PATTERN, title);
    }
  });
});

describe("parseDirName", () => {
  it("splits the spec's example", () => {
    assert.deepEqual(parseDirName("bqlybac0-login-timeout"), {
      id: "bqlybac0",
      slug: "login-timeout",
    });
  });

  it("rejects names that violate the grammar", () => {
    const bad = [
      "bqlybac0", // no slug
      "bqlybac0-", // empty slug
      "bqlybac0--x", // double hyphen
      "bqlybac-login", // id too short
      "feedback-login", // id has no digit
      "0qlybac1-login", // id starts with a digit
      "bqlybac0-Login", // uppercase slug
      "bqlybac0-login-", // trailing hyphen
    ];
    for (const name of bad) assert.equal(parseDirName(name), null, name);
  });
});
