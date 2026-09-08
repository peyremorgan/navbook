/**
 * The filter is the URL, so the round trip has to be exact: a query string
 * that means one filter must serialise back to itself, or the router will loop
 * replacing one spelling with another.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEADLINE_STATES,
  emptyFilter,
  FILTER_KEYS,
  filterQuery,
  filterToQuery,
  ISSUE_STATUSES,
  isEmptyFilter,
  joinTerms,
  PR_STATUSES,
  queryToFilter,
  splitTerms,
  toEntityFilter,
  withoutFilter,
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

/** What each listing's URL can say: the issue list is the one that is scheduled. */
const ISSUES = { statuses: ISSUE_STATUSES, deadlines: DEADLINE_STATES };
const PRS = { statuses: PR_STATUSES };

describe("queryToFilter", () => {
  it("reads every parameter, single or repeated", () => {
    const filter = queryToFilter(
      {
        status: ["open", "closed"],
        label: "bug",
        assignee: ["a@example.invalid", "b@example.invalid"],
        author: "c@example.invalid",
        milestone: "1.0",
        feature: ["auth", "billing"],
        reviewer: "d@example.invalid",
        deadline: ["overdue", "none"],
        q: "timeout",
      },
      ISSUES,
    );
    assert.deepEqual(filter, {
      status: ["OPEN", "CLOSED"],
      labels: ["bug"],
      assignees: ["a@example.invalid", "b@example.invalid"],
      authors: ["c@example.invalid"],
      milestones: ["1.0"],
      features: ["auth", "billing"],
      reviewers: ["d@example.invalid"],
      deadline: ["OVERDUE", "NONE"],
      text: "timeout",
    });
  });

  it("ignores a deadline on a listing whose noun is not scheduled", () => {
    // Only an issue has one (spec 02 §2.5), so `?deadline=overdue` on the pull
    // request list reads as no narrowing rather than as a filter the API would
    // refuse. Same rule as a status the listing cannot show.
    assert.deepEqual(queryToFilter({ deadline: "overdue" }, PRS).deadline, []);
    assert.deepEqual(queryToFilter({ deadline: "soon" }, ISSUES).deadline, []);
  });

  it("reads a deadline state in any case, in the schema's order", () => {
    assert.deepEqual(queryToFilter({ deadline: ["NoNe", "overdue"] }, ISSUES).deadline, [
      "OVERDUE",
      "NONE",
    ]);
  });

  it("is the empty filter when the URL says nothing", () => {
    assert.deepEqual(queryToFilter({}, ISSUES), emptyFilter());
    assert.ok(isEmptyFilter(queryToFilter({}, ISSUES)));
  });

  it("drops blanks and nulls rather than filtering on nothing", () => {
    const filter = queryToFilter(
      { label: ["", "  ", "bug", null], assignee: null, q: "  " },
      ISSUES,
    );
    assert.deepEqual(filter.labels, ["bug"]);
    assert.deepEqual(filter.assignees, []);
    assert.equal(filter.text, "");
  });

  it("ignores a status the listing cannot show, rather than refusing the URL", () => {
    // A shared link carrying `status=merged` should show the issue list, not
    // an error: URLs are typed by hand and outlive the page they came from.
    const filter = queryToFilter({ status: ["merged", "open"] }, ISSUES);
    assert.deepEqual(filter.status, ["OPEN"]);
    assert.deepEqual(queryToFilter({ status: "nonsense" }, ISSUES).status, []);
  });

  it("accepts merged on the pull request list, and any case", () => {
    assert.deepEqual(queryToFilter({ status: ["MeRgEd"] }, PRS).status, ["MERGED"]);
  });

  it("returns statuses in the schema's order, not the URL's", () => {
    // Stability is the point: two URLs meaning one filter must serialise alike.
    assert.deepEqual(queryToFilter({ status: ["closed", "open"] }, ISSUES).status, [
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

  it("writes deadline states in lower case too", () => {
    assert.deepEqual(filterToQuery({ ...emptyFilter(), deadline: ["OVERDUE"] }), {
      deadline: ["overdue"],
    });
  });

  it("round-trips a filter unchanged", () => {
    const original = {
      status: ["OPEN", "CLOSED"] as const,
      labels: ["bug", "auth"],
      assignees: ["a@example.invalid"],
      authors: ["b@example.invalid"],
      milestones: ["1.0"],
      features: ["auth"],
      reviewers: ["c@example.invalid"],
      deadline: ["OVERDUE" as const, "NONE" as const],
      text: 'timeout "slow link"',
    };
    const query = filterToQuery({ ...original, status: [...original.status] });
    const back = queryToFilter(query, ISSUES);
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

describe("filterQuery", () => {
  it("keeps the filter's parameters, and normalises them as queryToFilter would", () => {
    assert.deepEqual(
      filterQuery({
        status: ["open", null, " closed "],
        label: "bug",
        q: "   ",
        refs: "all",
        page: "2",
      }),
      { status: ["open", "closed"], label: ["bug"] },
    );
  });

  it("is empty when a URL carries nothing of the filter's", () => {
    assert.deepEqual(filterQuery({}), {});
    assert.deepEqual(filterQuery({ refs: "all" }), {});
    assert.deepEqual(filterQuery({ label: [], assignee: undefined, q: "" }), {});
  });

  it("survives a value of the wrong shape, since storage is not a URL", () => {
    // What comes back out of `sessionStorage` was written by some version of
    // this client, and has to fail as nothing remembered rather than as a
    // query string the router cannot navigate to.
    const nonsense = { label: 7, assignee: { bad: true }, status: [null, 3], q: ["ok"] };
    assert.deepEqual(filterQuery(nonsense as never), { q: ["ok"] });
  });

  it("names every parameter filterToQuery can write", () => {
    // The two lists have to agree: one decides what a listing puts in its
    // address, the other what is kept out of it and remembered.
    const written = filterToQuery({
      status: ["OPEN"],
      labels: ["bug"],
      assignees: ["a@example.invalid"],
      authors: ["b@example.invalid"],
      milestones: ["1.0"],
      features: ["auth"],
      reviewers: ["c@example.invalid"],
      deadline: ["OVERDUE"],
      text: "timeout",
    });
    assert.deepEqual(Object.keys(written).sort(), [...FILTER_KEYS].sort());
    assert.deepEqual(filterQuery(written), written);
  });
});

describe("withoutFilter", () => {
  it("keeps what the page owns and drops what the filter does", () => {
    assert.deepEqual(withoutFilter({ label: "bug", q: "x", status: "open", refs: "all" }), {
      refs: "all",
    });
    assert.deepEqual(withoutFilter({}), {});
  });

  it("leaves the original alone", () => {
    const query = { label: "bug", refs: "all" };
    withoutFilter(query);
    assert.deepEqual(query, { label: "bug", refs: "all" });
  });

  it("partitions a query with filterQuery, losing nothing the filter reads", () => {
    const query = { status: "closed", label: ["bug", "auth"], q: '"slow link"', refs: "all" };
    const rejoined = { ...withoutFilter(query), ...filterQuery(query) };
    assert.deepEqual(queryToFilter(rejoined, ISSUES), queryToFilter(query, ISSUES));
    assert.equal(rejoined.refs, "all");
  });
});
