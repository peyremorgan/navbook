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
      // Priority, unlike the listings: this page answers "what next", which is
      // the question a rank was written down to answer (spec 02 §2.5).
      sort: "priority",
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
        sort: "newest",
        q: "deadline",
      }),
      {
        view: "reviews",
        kind: "pr",
        feature: "authentication",
        finished: true,
        sort: "newest",
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

  it("reads priority when no order was named, since that is what an inbox is for", () => {
    assert.equal(queryToInboxParams({}).sort, "priority");
  });

  it("reads the order that was named, folded", () => {
    assert.equal(queryToInboxParams({ sort: "deadline" }).sort, "deadline");
    assert.equal(queryToInboxParams({ sort: "NEWEST" }).sort, "newest");
  });

  it("falls back rather than failing on an order that is not one", () => {
    // A URL is typed by hand and shared, and the inbox is a better answer
    // than an error — the same rule the view and the kind follow.
    assert.equal(queryToInboxParams({ sort: "priorty" }).sort, "priority");
    assert.equal(queryToInboxParams({ sort: "" }).sort, "priority");
  });
});

describe("inboxParamsToQuery", () => {
  const base = { sort: "priority" as const };
  const cases: InboxParams[] = [
    { view: "everything", kind: "any", feature: null, finished: false, text: "", ...base },
    {
      view: "assigned",
      kind: "issue",
      feature: "billing",
      finished: true,
      text: "deadline",
      ...base,
    },
    { view: "authored", kind: "pr", feature: null, finished: false, text: "", ...base },
    { view: "reviews", kind: "any", feature: "auth", finished: true, text: '"two words"', ...base },
    // A slug nobody lowercased, which has to come back exactly as it went in.
    {
      view: "everything",
      kind: "any",
      feature: "Authentication",
      finished: false,
      text: "",
      ...base,
    },
    { view: "everything", kind: "any", feature: null, finished: false, text: "", sort: "deadline" },
    { view: "everything", kind: "any", feature: null, finished: false, text: "", sort: "newest" },
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
        sort: "priority",
        text: "",
      }),
      { view: "reviews" },
    );
  });

  it("keeps an order that is not the default, and only that", () => {
    assert.deepEqual(
      inboxParamsToQuery({
        view: "everything",
        kind: "any",
        feature: null,
        finished: false,
        sort: "newest",
        text: "",
      }),
      { sort: "newest" },
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
