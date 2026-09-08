/**
 * The inbox is four answers made into one list, so what is worth proving is
 * that nothing is lost, nothing is doubled, and the order is the one every
 * listing already arrives in.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compareInboxItems,
  INBOX_REASONS,
  type InboxItem,
  type InboxSelection,
  inboxVariables,
  matchesSelection,
  mergeInbox,
  narrowInbox,
  railCounts,
  sameFeature,
} from "../../app/utils/inbox";
import type { IssueListItemFragment, PrListItemFragment } from "../../src/generated/gql/graphql";

function issue(id: string, extra: Partial<IssueListItemFragment> = {}): IssueListItemFragment {
  return {
    id,
    slug: `${id}-something`,
    kind: "ISSUE",
    status: "OPEN",
    path: `.navbook/issues/open/${id}-something`,
    archived: false,
    title: `Issue ${id}`,
    author: "A Person <person@example.invalid>",
    created: "2026-08-01T10:00:00Z",
    labels: [],
    assignees: [],
    milestone: null,
    features: [],
    resolution: null,
    ...extra,
  };
}

function pr(id: string, extra: Partial<PrListItemFragment> = {}): PrListItemFragment {
  return {
    id,
    slug: `${id}-something`,
    kind: "PR",
    status: "OPEN",
    path: `.navbook/prs/open/${id}-something`,
    archived: false,
    title: `Pull request ${id}`,
    author: "A Person <person@example.invalid>",
    created: "2026-08-01T10:00:00Z",
    labels: [],
    assignees: [],
    milestone: null,
    features: [],
    target: "main",
    source: "feat/thing",
    draft: false,
    refs: [],
    reviewers: [],
    reviewDecision: "PENDING",
    merged: null,
    ...extra,
  };
}

/** The shape the composable hands over, with the halves it does not use empty. */
const answers = (parts: {
  assignedIssues?: IssueListItemFragment[];
  assignedPrs?: PrListItemFragment[];
  authoredPrs?: PrListItemFragment[];
  awaitingPrs?: PrListItemFragment[];
}) => ({
  issues: [{ reason: "assigned" as const, entities: parts.assignedIssues ?? [] }],
  prs: [
    { reason: "assigned" as const, entities: parts.assignedPrs ?? [] },
    { reason: "author" as const, entities: parts.authoredPrs ?? [] },
    { reason: "awaiting" as const, entities: parts.awaitingPrs ?? [] },
  ],
});

describe("mergeInbox", () => {
  it("is empty when every answer is", () => {
    assert.deepEqual(mergeInbox(answers({})), []);
    assert.deepEqual(mergeInbox({ issues: [], prs: [] }), []);
  });

  it("keeps which answer each entity came back in", () => {
    const items = mergeInbox(
      answers({ assignedIssues: [issue("aaaa0001")], awaitingPrs: [pr("bbbb0002")] }),
    );
    // Both were created at the same instant here, so the id breaks the tie.
    assert.deepEqual(
      items.map((item) => [item.kind, item.id, item.reasons]),
      [
        ["issue", "aaaa0001", ["assigned"]],
        ["pr", "bbbb0002", ["awaiting"]],
      ],
    );
  });

  it("holds an entity once, carrying every reason it has", () => {
    const mine = pr("bbbb0001");
    const items = mergeInbox(answers({ assignedPrs: [mine], authoredPrs: [mine] }));
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]?.reasons, ["assigned", "author"]);
  });

  it("orders the reasons the same way however they arrived", () => {
    const mine = pr("bbbb0001");
    const forwards = mergeInbox({
      issues: [],
      prs: [
        { reason: "assigned", entities: [mine] },
        { reason: "author", entities: [mine] },
        { reason: "awaiting", entities: [mine] },
      ],
    });
    const backwards = mergeInbox({
      issues: [],
      prs: [
        { reason: "awaiting", entities: [mine] },
        { reason: "author", entities: [mine] },
        { reason: "assigned", entities: [mine] },
      ],
    });
    assert.deepEqual(forwards[0]?.reasons, [...INBOX_REASONS]);
    assert.deepEqual(backwards[0]?.reasons, [...INBOX_REASONS]);
  });

  it("never counts a reason twice", () => {
    const mine = pr("bbbb0001");
    const items = mergeInbox({
      issues: [],
      // The open half and the finished half both ask about assignment.
      prs: [
        { reason: "assigned", entities: [mine] },
        { reason: "assigned", entities: [mine] },
      ],
    });
    assert.deepEqual(items[0]?.reasons, ["assigned"]);
  });

  it("keeps an issue and a pull request apart even if they shared an id", () => {
    const items = mergeInbox(
      answers({ assignedIssues: [issue("aaaa0001")], assignedPrs: [pr("aaaa0001")] }),
    );
    assert.equal(items.length, 2);
    assert.deepEqual(new Set(items.map((item) => item.kind)), new Set(["issue", "pr"]));
  });

  it("puts the newest first, breaking ties on the id", () => {
    const items = mergeInbox(
      answers({
        assignedIssues: [
          issue("aaaa0003", { created: "2026-08-02T09:00:00Z" }),
          issue("aaaa0001", { created: "2026-08-05T09:00:00Z" }),
          // Same instant as aaaa0003, so the id decides and does so ascending.
          issue("aaaa0002", { created: "2026-08-02T09:00:00Z" }),
        ],
      }),
    );
    assert.deepEqual(
      items.map((item) => item.id),
      ["aaaa0001", "aaaa0002", "aaaa0003"],
    );
  });

  it("mixes finished work in by date rather than appending it", () => {
    const items = mergeInbox({
      issues: [
        { reason: "assigned", entities: [issue("aaaa0002", { created: "2026-08-02T09:00:00Z" })] },
        {
          reason: "assigned",
          entities: [issue("aaaa0009", { created: "2026-08-09T09:00:00Z", status: "CLOSED" })],
        },
      ],
      prs: [],
    });
    assert.deepEqual(
      items.map((item) => item.id),
      ["aaaa0009", "aaaa0002"],
    );
  });
});

describe("compareInboxItems", () => {
  const item = (id: string, created: string): InboxItem => ({
    kind: "issue",
    id,
    reasons: ["assigned"],
    entity: issue(id, { created }),
  });

  it("puts the later timestamp first", () => {
    const newer = item("b", "2026-08-02T09:30:00Z");
    const older = item("a", "2026-08-02T09:15:00Z");
    assert.ok(compareInboxItems(newer, older) < 0);
    assert.ok(compareInboxItems(older, newer) > 0);
  });

  it("compares the timestamp as text, without parsing it", () => {
    // Core compares the raw frontmatter value, so a value it cannot parse is
    // still something to order — placed by its text, and never a reason to
    // fail. Where it lands is not worth pinning; that it lands is.
    const sane = item("a", "2026-08-02T09:15:00Z");
    const nonsense = item("b", "not a date at all");
    assert.equal(compareInboxItems(sane, nonsense), -compareInboxItems(nonsense, sane));
    assert.notEqual(compareInboxItems(sane, nonsense), 0);
  });

  it("is zero only for the same row", () => {
    const created = "2026-08-01T10:00:00Z";
    assert.equal(compareInboxItems(item("a", created), item("a", created)), 0);
    assert.notEqual(compareInboxItems(item("a", created), item("b", created)), 0);
  });
});

/* ------------------------------------------------------------------ narrow */

const everything: InboxSelection = { view: "everything", kind: "any", feature: null };

const sample: InboxItem[] = [
  {
    kind: "issue",
    id: "aaaa0001",
    reasons: ["assigned"],
    entity: issue("aaaa0001", { features: ["authentication"] }),
  },
  {
    kind: "pr",
    id: "bbbb0001",
    reasons: ["assigned", "author"],
    entity: pr("bbbb0001", { features: ["authentication", "billing"] }),
  },
  { kind: "pr", id: "bbbb0002", reasons: ["awaiting"], entity: pr("bbbb0002") },
];

describe("narrowInbox", () => {
  it("keeps everything when nothing is chosen", () => {
    assert.equal(narrowInbox(sample, everything).length, 3);
  });

  it("narrows to one reason", () => {
    const ids = (selection: InboxSelection) =>
      narrowInbox(sample, selection).map((item) => item.id);
    assert.deepEqual(ids({ ...everything, view: "assigned" }), ["aaaa0001", "bbbb0001"]);
    assert.deepEqual(ids({ ...everything, view: "authored" }), ["bbbb0001"]);
    assert.deepEqual(ids({ ...everything, view: "reviews" }), ["bbbb0002"]);
  });

  it("narrows to one kind", () => {
    assert.deepEqual(
      narrowInbox(sample, { ...everything, kind: "issue" }).map((item) => item.id),
      ["aaaa0001"],
    );
    assert.deepEqual(
      narrowInbox(sample, { ...everything, kind: "pr" }).map((item) => item.id),
      ["bbbb0001", "bbbb0002"],
    );
  });

  it("forgives the case of a slug, as core does when it matches one", () => {
    assert.ok(sameFeature("Authentication", "authentication"));
    assert.ok(!sameFeature("authentication", "billing"));
    assert.deepEqual(
      narrowInbox(sample, { ...everything, feature: "AUTHENTICATION" }).map((item) => item.id),
      ["aaaa0001", "bbbb0001"],
    );
  });

  it("narrows to one feature, and to none at all", () => {
    assert.deepEqual(
      narrowInbox(sample, { ...everything, feature: "billing" }).map((item) => item.id),
      ["bbbb0001"],
    );
    assert.deepEqual(narrowInbox(sample, { ...everything, feature: "nothing" }), []);
  });

  it("ANDs the three groups", () => {
    assert.deepEqual(
      narrowInbox(sample, { view: "authored", kind: "pr", feature: "authentication" }).map(
        (item) => item.id,
      ),
      ["bbbb0001"],
    );
    assert.deepEqual(narrowInbox(sample, { view: "authored", kind: "issue", feature: null }), []);
  });

  it("agrees with matchesSelection", () => {
    for (const item of sample) {
      assert.equal(
        narrowInbox([item], { ...everything, view: "assigned" }).length === 1,
        matchesSelection(item, { ...everything, view: "assigned" }),
      );
    }
  });
});

describe("railCounts", () => {
  it("counts each entry as what choosing it would show", () => {
    const counts = railCounts(sample, everything);
    assert.deepEqual(
      counts.views.map((entry) => [entry.value, entry.count]),
      [
        ["everything", 3],
        ["assigned", 2],
        ["authored", 1],
        ["reviews", 1],
      ],
    );
    assert.deepEqual(
      counts.kinds.map((entry) => [entry.value, entry.count]),
      [
        ["any", 3],
        ["issue", 1],
        ["pr", 2],
      ],
    );
  });

  it("counts with the other groups still applied", () => {
    // Only pull requests are in play, so the issue that is assigned drops out
    // of the assigned count as well.
    const counts = railCounts(sample, { ...everything, kind: "pr" });
    assert.deepEqual(
      counts.views.map((entry) => entry.count),
      [2, 1, 1, 1],
    );
    // The kind group counts itself as if the others were still chosen, which
    // is what makes "Anything" the way back.
    assert.deepEqual(
      counts.kinds.map((entry) => entry.count),
      [3, 1, 2],
    );
  });

  it("offers every feature the inbox mentions, sorted, with Any first", () => {
    const counts = railCounts(sample, everything);
    assert.deepEqual(
      counts.features.map((entry) => [entry.value, entry.count]),
      [
        [null, 3],
        ["authentication", 2],
        ["billing", 1],
      ],
    );
  });

  it("does not offer a slug twice for having been capitalised twice", () => {
    const counts = railCounts(sample, { ...everything, feature: "AUTHENTICATION" });
    assert.deepEqual(
      counts.features.map((entry) => entry.value),
      [null, "authentication", "billing"],
    );
    // And the chosen one is counted as what choosing it shows, not as nothing.
    assert.equal(counts.features[1]?.count, 2);
  });

  it("keeps a chosen feature nothing carries, so it can be taken off", () => {
    // A filter you cannot see is one you cannot remove, so the slug from the
    // URL is offered too — counting what it would show, which is nothing.
    const counts = railCounts(sample, { ...everything, feature: "nothing" });
    assert.deepEqual(
      counts.features.map((entry) => [entry.value, entry.count]),
      [
        [null, 3],
        ["authentication", 2],
        ["billing", 1],
        ["nothing", 0],
      ],
    );
  });

  it("offers only Any when nothing names a feature", () => {
    const counts = railCounts([sample[2] as InboxItem], everything);
    assert.deepEqual(counts.features, [{ value: null, count: 1 }]);
  });

  it("is all zeroes for an empty inbox", () => {
    const counts = railCounts([], everything);
    assert.deepEqual(
      counts.views.map((entry) => entry.count),
      [0, 0, 0, 0],
    );
    assert.deepEqual(counts.features, [{ value: null, count: 0 }]);
  });
});

describe("inboxVariables", () => {
  it("asks about one address, and says whether finished work is wanted", () => {
    assert.deepEqual(inboxVariables("me@example.invalid", { finished: false, text: "" }), {
      me: "me@example.invalid",
      finished: false,
      text: null,
    });
    assert.deepEqual(
      inboxVariables("me@example.invalid", { finished: true, text: "" }).finished,
      true,
    );
  });

  it("splits the search box into terms, as the listing does", () => {
    assert.deepEqual(
      inboxVariables("me@example.invalid", { finished: false, text: 'deadline "slow connections"' })
        .text,
      ["deadline", "slow connections"],
    );
  });

  it("sends null rather than an empty list for a blank box", () => {
    // Absent and empty mean the same to the server; one shape keeps Apollo
    // watching one query rather than two.
    assert.equal(inboxVariables("me@example.invalid", { finished: false, text: "   " }).text, null);
  });
});
