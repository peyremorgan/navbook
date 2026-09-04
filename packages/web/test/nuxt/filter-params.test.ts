/**
 * The filter is the URL, so the round trip has to be exact: a query string
 * that means one filter must serialise back to itself, or the router will loop
 * replacing one spelling with another.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  emptyFilter,
  filterToQuery,
  ISSUE_STATUSES,
  isEmptyFilter,
  joinTerms,
  PR_STATUSES,
  queryToFilter,
  splitTerms,
  toEntityFilter,
} from "../../app/utils/filter-params";

describe("splitTerms", () => {
  it("splits on whitespace, since terms AND together on the server", () => {
    assert.deepEqual(splitTerms("login timeout"), ["login", "timeout"]);
    assert.deepEqual(splitTerms("  login \t timeout \n"), ["login", "timeout"]);
  });

  it("keeps a quoted phrase whole", () => {
    assert.deepEqual(splitTerms('"login times out" slow'), ["login times out", "slow"]);
  });

  it("runs an unclosed quote to the end rather than failing", () => {
    assert.deepEqual(splitTerms('"login times out'), ["login times out"]);
  });

  it("is empty for nothing", () => {
    assert.deepEqual(splitTerms(""), []);
    assert.deepEqual(splitTerms("   "), []);
    assert.deepEqual(splitTerms('""'), []);
  });

  it("round-trips through joinTerms", () => {
    for (const terms of [["a"], ["a", "b"], ["a phrase", "b"], []]) {
      assert.deepEqual(splitTerms(joinTerms(terms)), terms);
    }
  });
});

describe("queryToFilter", () => {
  it("reads every parameter, single or repeated", () => {
    const filter = queryToFilter(
      {
        status: ["open", "closed"],
        label: "bug",
        assignee: ["a@example.invalid", "b@example.invalid"],
        author: "c@example.invalid",
        milestone: "1.0",
        q: "timeout",
      },
      ISSUE_STATUSES,
    );
    assert.deepEqual(filter, {
      status: ["OPEN", "CLOSED"],
      labels: ["bug"],
      assignees: ["a@example.invalid", "b@example.invalid"],
      authors: ["c@example.invalid"],
      milestones: ["1.0"],
      text: "timeout",
    });
  });

  it("is the empty filter when the URL says nothing", () => {
    assert.deepEqual(queryToFilter({}, ISSUE_STATUSES), emptyFilter());
    assert.ok(isEmptyFilter(queryToFilter({}, ISSUE_STATUSES)));
  });

  it("drops blanks and nulls rather than filtering on nothing", () => {
    const filter = queryToFilter(
      { label: ["", "  ", "bug", null], assignee: null, q: "  " },
      ISSUE_STATUSES,
    );
    assert.deepEqual(filter.labels, ["bug"]);
    assert.deepEqual(filter.assignees, []);
    assert.equal(filter.text, "");
  });

  it("ignores a status the listing cannot show, rather than refusing the URL", () => {
    // A shared link carrying `status=merged` should show the issue list, not
    // an error: URLs are typed by hand and outlive the page they came from.
    const filter = queryToFilter({ status: ["merged", "open"] }, ISSUE_STATUSES);
    assert.deepEqual(filter.status, ["OPEN"]);
    assert.deepEqual(queryToFilter({ status: "nonsense" }, ISSUE_STATUSES).status, []);
  });

  it("accepts merged on the pull request list, and any case", () => {
    assert.deepEqual(queryToFilter({ status: ["MeRgEd"] }, PR_STATUSES).status, ["MERGED"]);
  });

  it("returns statuses in the schema's order, not the URL's", () => {
    // Stability is the point: two URLs meaning one filter must serialise alike.
    assert.deepEqual(queryToFilter({ status: ["closed", "open"] }, ISSUE_STATUSES).status, [
      "OPEN",
      "CLOSED",
    ]);
  });
});

describe("filterToQuery", () => {
  it("leaves out everything empty", () => {
    assert.deepEqual(filterToQuery(emptyFilter()), {});
  });

  it("writes statuses in lower case, as a URL reads best", () => {
    assert.deepEqual(filterToQuery({ ...emptyFilter(), status: ["OPEN", "CLOSED"] }), {
      status: ["open", "closed"],
    });
  });

  it("round-trips a filter unchanged", () => {
    const original = {
      status: ["OPEN", "CLOSED"] as const,
      labels: ["bug", "auth"],
      assignees: ["a@example.invalid"],
      authors: ["b@example.invalid"],
      milestones: ["1.0"],
      text: 'timeout "slow link"',
    };
    const query = filterToQuery({ ...original, status: [...original.status] });
    const back = queryToFilter(query, ISSUE_STATUSES);
    assert.deepEqual(back, { ...original, status: [...original.status] });
    // And again, so the second pass is a fixed point.
    assert.deepEqual(filterToQuery(back), query);
  });
});

describe("toEntityFilter", () => {
  it("sends nothing at all for an empty filter", () => {
    // An omitted key and an empty one mean the same thing to the server, so
    // sending empty keys would only be noise on the wire.
    assert.deepEqual(toEntityFilter(emptyFilter()), {});
  });

  it("sends only the keys that are set", () => {
    assert.deepEqual(toEntityFilter({ ...emptyFilter(), labels: ["bug"] }), { labels: ["bug"] });
  });

  it("splits the search box into terms", () => {
    assert.deepEqual(toEntityFilter({ ...emptyFilter(), text: '"slow link" timeout' }).text, [
      "slow link",
      "timeout",
    ]);
  });

  it("passes statuses through in the schema's spelling", () => {
    assert.deepEqual(toEntityFilter({ ...emptyFilter(), status: ["CLOSED"] }).status, ["CLOSED"]);
  });
});
