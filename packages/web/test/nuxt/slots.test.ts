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
  toIssueFilter,
  toPrFilter,
} from "~/utils/filter-params";
import { INBOX_GROUPINGS } from "~/utils/inbox";
import {
  buildEntityPatch,
  describeEntityEdit,
  type EntityEdit,
  fieldLabel,
  PATCH_EXTENSIONS,
} from "~/utils/patch";

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
    assert.deepEqual(FILTER_EXTENSIONS, [
      { param: "report", apiField: "reports", nouns: ["issue"] },
    ]);
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
    useNavbookSlots().register({
      filters: [
        {
          param: "report",
          apiField: "reports",
          label: "Report",
          icon: "i-lucide-flask",
          nouns: ["issue", "pr"],
          options: () => [],
        },
      ],
    });
    const filter = { ...emptyFilter(), ext: { report: ["failing"] } };
    for (const sent of [toIssueFilter(filter), toPrFilter(filter)]) {
      assert.deepEqual((sent as Record<string, unknown>).reports, ["failing"]);
    }
  });

  it("is neither read nor sent on a listing it was not registered for", () => {
    // Its SDL may have added the field to `IssueFilter` alone, and the API
    // refuses a field its input does not have.
    registerReports();
    const filter = { ...emptyFilter(), ext: { report: ["failing"] } };
    assert.deepEqual((toIssueFilter(filter) as Record<string, unknown>).reports, ["failing"]);
    assert.equal((toPrFilter(filter) as Record<string, unknown>).reports, undefined);
    assert.deepEqual(
      queryToFilter({ report: "failing" }, { ...ISSUES, noun: "issue" }).ext.report,
      ["failing"],
    );
    assert.deepEqual(
      queryToFilter({ report: "failing" }, { statuses: ["OPEN"], noun: "pr" }).ext,
      {},
    );
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

describe("a registered entity field", () => {
  /** An entity as a detail page shows it, with a plugin's field on it. */
  const entity = (reports: string[]): EntityEdit => ({
    title: "Sign-in is unreliable",
    body: "It gives up too early.",
    labels: [],
    assignees: [],
    milestone: null,
    ext: { reports },
  });

  const registerReports = (): void => {
    useNavbookSlots().register({
      entityFields: [
        {
          field: "reports",
          label: "test reports",
          read: (ext) => ((ext.probe as { reports?: string[] })?.reports ?? []) as string[],
        },
      ],
    });
  };

  it("reaches the pure patch builder", () => {
    registerReports();
    assert.deepEqual(PATCH_EXTENSIONS, [{ field: "reports", label: "test reports" }]);
  });

  it("is sent under the name its plugin's schema added to the input", () => {
    registerReports();
    const patch = buildEntityPatch(entity([]), { ext: { reports: ["nightly"] } }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(patch.reports, ["nightly"]);
  });

  it("is left out when it has not changed, so nothing else is rewritten", () => {
    registerReports();
    assert.equal(buildEntityPatch(entity(["nightly"]), { ext: { reports: ["nightly"] } }), null);
  });

  it("sends an empty list, which is how the mutation spells 'remove it'", () => {
    registerReports();
    const patch = buildEntityPatch(entity(["nightly"]), { ext: { reports: [] } }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(patch.reports, []);
  });

  it("ignores an ext key nothing registered", () => {
    // A field no loaded plugin has. Sending it would ask the server to refuse
    // an input it does not have either.
    assert.equal(buildEntityPatch(entity([]), { ext: { reports: ["nightly"] } }), null);
  });

  it("reads back under the name a person would recognise", () => {
    // This is the alert beside a refused edit, so "ext" would say nothing.
    registerReports();
    assert.equal(fieldLabel("reports"), "test reports");
    assert.deepEqual(describeEntityEdit({ ext: { reports: ["nightly"] } }), [
      { field: "test reports", value: "nightly" },
    ]);
    assert.deepEqual(describeEntityEdit({ ext: { reports: [] } }), [
      { field: "test reports", value: "none" },
    ]);
  });

  it("finds its value on an entity through the reader its layer gave", () => {
    registerReports();
    const field = useNavbookSlots().entityFields()[0];
    assert.deepEqual(field?.read({ probe: { reports: ["nightly"] } }), ["nightly"]);
    assert.deepEqual(field?.read({}), []);
  });
});

describe("registered cache policies", () => {
  it("merge what every layer asked for into one map each", () => {
    const slots = useNavbookSlots();
    slots.register({
      cache: {
        typePolicies: { Report: { keyFields: ["id"] } },
        queryFields: { reports: { keyArgs: [] } },
      },
    });
    slots.register({ cache: { typePolicies: { Build: { keyFields: ["sha"] } } } });
    assert.deepEqual(slots.typePolicies(), {
      Report: { keyFields: ["id"] },
      Build: { keyFields: ["sha"] },
    });
    assert.deepEqual(slots.queryFields(), { reports: { keyArgs: [] } });
  });

  it("are empty with nothing registered, so the host's own map is untouched", () => {
    const slots = useNavbookSlots();
    assert.deepEqual(slots.typePolicies(), {});
    assert.deepEqual(slots.queryFields(), {});
  });
});

describe("resetting", () => {
  it("empties the registry and every list it pushes to", () => {
    // Three of the slots keep a copy outside this registry, so that the pure
    // functions over them stay testable without an app. A reset that emptied
    // only the registry would leak a plugin's parameter, field or grouping
    // from one test file into the next.
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
      entityFields: [{ field: "x", label: "X", read: () => [] }],
      inboxGroups: [{ key: "x", label: "X", icon: "i", values: () => [], matches: () => false }],
      cache: { typePolicies: { X: { keyFields: ["id"] } } },
    });
    resetNavbookSlots();
    assert.deepEqual(slots.navLinks(), []);
    assert.deepEqual(slots.entityFields(), []);
    assert.deepEqual(slots.inboxGroups(), []);
    assert.deepEqual(slots.typePolicies(), {});
    assert.deepEqual(FILTER_EXTENSIONS, []);
    assert.deepEqual(PATCH_EXTENSIONS, []);
    assert.deepEqual(INBOX_GROUPINGS, []);
  });
});
