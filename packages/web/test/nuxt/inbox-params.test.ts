/**
 * The inbox view is the URL, so the round trip has to be exact: a query string
 * that means one view must serialise back to itself, or the router will loop
 * replacing one spelling with another. And it has to be forgiving — a URL is
 * typed by hand and shared, and a word this page does not know is a reason to
 * show the inbox, not to fail.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  defaultInboxParams,
  type InboxParams,
  inboxParamsToQuery,
  queryToInboxParams,
} from "../../app/utils/inbox-params";

describe("defaultInboxParams", () => {
  it("is what a URL with none of our parameters means", () => {
    assert.deepEqual(defaultInboxParams(), {
      view: "everything",
      kind: "any",
      feature: null,
      finished: false,
      text: "",
    });
    assert.deepEqual(queryToInboxParams({}), defaultInboxParams());
  });

  it("says nothing in the query string", () => {
    assert.deepEqual(inboxParamsToQuery(defaultInboxParams()), {});
  });
});

describe("queryToInboxParams", () => {
  it("reads every parameter", () => {
    assert.deepEqual(
      queryToInboxParams({
        view: "reviews",
        kind: "pr",
        feature: "authentication",
        status: "all",
        q: "deadline",
      }),
      {
        view: "reviews",
        kind: "pr",
        feature: "authentication",
        finished: true,
        text: "deadline",
      },
    );
  });

  it("takes the first of a repeated parameter, since each group picks one", () => {
    const params = queryToInboxParams({ view: ["assigned", "authored"], kind: ["issue", "pr"] });
    assert.equal(params.view, "assigned");
    assert.equal(params.kind, "issue");
  });

  it("forgives the case its own words were typed in", () => {
    const params = queryToInboxParams({ view: "Reviews", kind: "PR", status: "ALL" });
    assert.equal(params.view, "reviews");
    assert.equal(params.kind, "pr");
    assert.equal(params.finished, true);
  });

  it("carries a slug through as written, since it is not one of our words", () => {
    // Folding it here would make the round trip lossy, and the rail would
    // stop recognising the entry it had just written. `sameFeature` is where
    // the case is forgiven instead.
    assert.equal(queryToInboxParams({ feature: "Authentication" }).feature, "Authentication");
  });

  it("falls back to the default for a word it does not know", () => {
    const params = queryToInboxParams({ view: "mine", kind: "feature", status: "open" });
    assert.equal(params.view, "everything");
    assert.equal(params.kind, "any");
    assert.equal(params.finished, false);
  });

  it("reads a blank parameter as an absent one", () => {
    assert.deepEqual(queryToInboxParams({ view: "", feature: "  ", q: "" }), defaultInboxParams());
    assert.deepEqual(queryToInboxParams({ view: null, feature: undefined }), defaultInboxParams());
  });

  it("splits and rejoins the search box, as the listings do", () => {
    assert.equal(queryToInboxParams({ q: '"slow connections" 3g' }).text, '"slow connections" 3g');
    assert.equal(queryToInboxParams({ q: ["deadline", "thirty"] }).text, "deadline thirty");
  });

  it("names everything as the default view, however it was asked for", () => {
    assert.equal(queryToInboxParams({ view: "everything" }).view, "everything");
  });
});

describe("inboxParamsToQuery", () => {
  const cases: InboxParams[] = [
    { view: "everything", kind: "any", feature: null, finished: false, text: "" },
    { view: "assigned", kind: "issue", feature: "billing", finished: true, text: "deadline" },
    { view: "authored", kind: "pr", feature: null, finished: false, text: "" },
    { view: "reviews", kind: "any", feature: "auth", finished: true, text: '"two words"' },
    // A slug nobody lowercased, which has to come back exactly as it went in.
    { view: "everything", kind: "any", feature: "Authentication", finished: false, text: "" },
  ];

  it("round-trips every combination", () => {
    for (const params of cases) {
      assert.deepEqual(queryToInboxParams(inboxParamsToQuery(params)), params);
    }
  });

  it("leaves every default out, so a shared URL says only what was chosen", () => {
    assert.deepEqual(
      inboxParamsToQuery({
        view: "reviews",
        kind: "any",
        feature: null,
        finished: false,
        text: "",
      }),
      { view: "reviews" },
    );
  });

  it("writes finished work as a status rather than a flag of its own", () => {
    assert.deepEqual(inboxParamsToQuery({ ...defaultInboxParams(), finished: true }), {
      status: "all",
    });
  });

  it("drops a feature that is present but empty", () => {
    assert.deepEqual(inboxParamsToQuery({ ...defaultInboxParams(), feature: "" }), {});
  });

  it("is stable: serialising twice changes nothing", () => {
    for (const params of cases) {
      const once = inboxParamsToQuery(params);
      assert.deepEqual(inboxParamsToQuery(queryToInboxParams(once)), once);
    }
  });
});
