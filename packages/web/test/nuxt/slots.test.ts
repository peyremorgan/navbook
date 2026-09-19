/**
 * The slot registry a plugin layer fills — spec 02 §2.12.
 *
 * What is worth testing here is not that a registered thing comes back, but
 * the two rules around it: ordering, so a plugin can sit *between* built-in
 * tabs rather than only after them, and the link between a registered filter
 * and the pure query-string functions, which keep their own list so they stay
 * testable without an app.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { defineComponent } from "vue";
import { resetNavbookSlots, useNavbookSlots } from "~/composables/useNavbookSlots";
import {
  emptyFilter,
  FILTER_EXTENSIONS,
  filterToQuery,
  isEmptyFilter,
  queryToFilter,
  toEntityFilter,
} from "~/utils/filter-params";

const Stub = defineComponent({ template: "<div />" });
const ISSUES = { statuses: ["OPEN", "CLOSED"] as const, deadlines: ["OVERDUE", "NONE"] as const };

afterEach(() => resetNavbookSlots());

describe("nav links", () => {
  it("returns what a layer registered", () => {
    useNavbookSlots().register({
      navLinks: [{ label: "Reports", to: "/reports", icon: "i-lucide-flask" }],
    });
    const links = useNavbookSlots().navLinks();
    assert.equal(links.length, 1);
    assert.equal(links[0]?.label, "Reports");
  });

  it("orders by `order`, so a plugin can sit between the built-in tabs", () => {
    const slots = useNavbookSlots();
    slots.register({
      navLinks: [
        { label: "Last", to: "/c", icon: "i", order: 300 },
        { label: "First", to: "/a", icon: "i", order: 10 },
      ],
    });
    slots.register({ navLinks: [{ label: "Middle", to: "/b", icon: "i", order: 150 }] });
    assert.deepEqual(
      slots.navLinks().map((link) => link.label),
      ["First", "Middle", "Last"],
    );
  });

  it("keeps registration order for links that name none", () => {
    const slots = useNavbookSlots();
    slots.register({
      navLinks: [
        { label: "One", to: "/1", icon: "i" },
        { label: "Two", to: "/2", icon: "i" },
      ],
    });
    assert.deepEqual(
      slots.navLinks().map((link) => link.label),
      ["One", "Two"],
    );
  });
});

describe("panels", () => {
  it("are returned for the noun they named, and only that one", () => {
    const slots = useNavbookSlots();
    slots.register({
      panels: [
        { noun: "issue", component: Stub },
        { noun: "pr", component: Stub },
        { noun: "issue", component: Stub },
      ],
    });
    assert.equal(slots.panels("issue").length, 2);
    assert.equal(slots.panels("pr").length, 1);
  });
});

describe("form fields", () => {
  it("are returned for the form they named", () => {
    const slots = useNavbookSlots();
    slots.register({ formFields: [{ form: "issue-new", component: Stub }] });
    assert.equal(slots.formFields("issue-new").length, 1);
  });
});

describe("listings", () => {
  it("collects names without repeating one two plugins both claim", () => {
    const slots = useNavbookSlots();
    slots.register({ listings: ["reports"] });
    slots.register({ listings: ["reports", "builds"] });
    assert.deepEqual(slots.listings(), ["reports", "builds"]);
  });
});

describe("a registered filter", () => {
  const registerReports = (): void => {
    useNavbookSlots().register({
      filters: [
        {
          param: "report",
          apiField: "reports",
          label: "Report",
          icon: "i-lucide-flask",
          nouns: ["issue"],
          options: () => ["passing", "failing"],
        },
      ],
    });
  };

  it("reaches the pure query-string functions", () => {
    registerReports();
    assert.deepEqual(FILTER_EXTENSIONS, [{ param: "report", apiField: "reports" }]);
  });

  it("is read out of a query string", () => {
    registerReports();
    const filter = queryToFilter({ report: ["failing", "flaky"] }, ISSUES);
    assert.deepEqual(filter.ext.report, ["failing", "flaky"]);
  });

  it("round-trips through the query string unchanged", () => {
    registerReports();
    const original = { ...emptyFilter(), ext: { report: ["failing"] } };
    const query = filterToQuery(original);
    assert.deepEqual(query.report, ["failing"]);
    assert.deepEqual(queryToFilter(query, ISSUES), original);
    // And again, so the second pass is a fixed point — the router replaces the
    // address with what this returns, and an unstable answer would loop.
    assert.deepEqual(filterToQuery(queryToFilter(query, ISSUES)), query);
  });

  it("is sent to the API under the field its plugin's schema added", () => {
    registerReports();
    const sent = toEntityFilter({ ...emptyFilter(), ext: { report: ["failing"] } }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(sent.reports, ["failing"]);
  });

  it("counts towards whether a filter is empty", () => {
    // Otherwise a listing filtered only by a plugin's chip would render as
    // though nothing were filtered, and offer no way to clear it.
    registerReports();
    assert.equal(isEmptyFilter(emptyFilter()), true);
    assert.equal(isEmptyFilter({ ...emptyFilter(), ext: { report: ["failing"] } }), false);
    assert.equal(isEmptyFilter({ ...emptyFilter(), ext: { report: [] } }), true);
  });

  it("is offered only on the nouns it named", () => {
    registerReports();
    assert.equal(useNavbookSlots().filters("issue").length, 1);
    assert.equal(useNavbookSlots().filters("pr").length, 0);
  });

  it("leaves a parameter nobody registered out of the filter entirely", () => {
    // Without this, any stray query parameter would become filter state and
    // then be written back into the address.
    const filter = queryToFilter({ report: ["failing"] }, ISSUES);
    assert.deepEqual(filter.ext, {});
    assert.equal(filterToQuery(filter).report, undefined);
  });
});

describe("resetting", () => {
  it("empties the registry and the filter list together", () => {
    const slots = useNavbookSlots();
    slots.register({
      navLinks: [{ label: "X", to: "/x", icon: "i" }],
      filters: [
        {
          param: "x",
          apiField: "x",
          label: "X",
          icon: "i",
          nouns: ["issue"],
          options: () => [],
        },
      ],
    });
    resetNavbookSlots();
    assert.deepEqual(slots.navLinks(), []);
    assert.deepEqual(FILTER_EXTENSIONS, []);
  });
});
