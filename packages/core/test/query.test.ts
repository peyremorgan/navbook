import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewPolicy } from "../src/core/policy.ts";
import {
  isQueryError,
  matchesQuery,
  needsComments,
  parseQuery,
  type Query,
} from "../src/core/query.ts";
import { type EntityRecord, type NavTree, parseTree } from "../src/core/tree.ts";

interface IssueSpec {
  id: string;
  title?: string;
  body?: string;
  labels?: string[];
  assignee?: string;
  author?: string;
  milestone?: string;
  features?: string[];
  deadline?: string;
  status?: "open" | "closed";
  comments?: string[];
}

function build(specs: IssueSpec[]): EntityRecord[] {
  const entries: Record<string, string> = {};
  for (const spec of specs) {
    const dir = `issues/${spec.status ?? "open"}/${spec.id}-slug`;
    const lines = [
      "---",
      `title: ${spec.title ?? "A title"}`,
      `author: ${spec.author ?? "alice@example.com"}`,
      "created: 2026-08-02T09:14:00Z",
    ];
    if (spec.labels) lines.push(`labels: [${spec.labels.join(", ")}]`);
    if (spec.assignee) lines.push(`assignee: ${spec.assignee}`);
    if (spec.milestone) lines.push(`milestone: ${spec.milestone}`);
    if (spec.features) lines.push(`feature: [${spec.features.join(", ")}]`);
    if (spec.deadline) lines.push(`deadline: ${spec.deadline}`);
    lines.push("---", "", spec.body ?? "Body text.", "");
    entries[`${dir}/issue.md`] = lines.join("\n");
    (spec.comments ?? []).forEach((body, index) => {
      entries[`${dir}/comments/2026-08-0${index + 3}T141207Z-aaaaaaa${index + 1}.md`] =
        `---\nauthor: bob@example.com\n---\n\n${body}\n`;
    });
  }
  return parseTree(new Map(Object.entries(entries)) as NavTree).issues;
}

const query = (...terms: string[]): Query => {
  const result = parseQuery(terms, "issue");
  assert.equal(isQueryError(result), false, JSON.stringify(result));
  return result as Query;
};

const matching = (entities: EntityRecord[], ...terms: string[]): string[] =>
  entities
    .filter((e) => matchesQuery(query(...terms), e))
    .map((e) => e.id)
    .sort();

describe("parseQuery", () => {
  it("leaves the status unnamed when no status term is given", () => {
    assert.deepEqual(query().status, []);
  });

  it("rejects a status that does not exist for the noun", () => {
    const result = parseQuery(["status:merged"], "issue");
    assert.equal(isQueryError(result), true);
    assert.match((result as { message: string }).message, /unknown status 'merged' for issues/);
    assert.equal(isQueryError(parseQuery(["status:merged"], "pr")), false);
  });

  it("rejects a keyed term with no value", () => {
    assert.match(
      (parseQuery(["label:"], "issue") as { message: string }).message,
      /missing a value/,
    );
  });

  it("treats unknown key:value shapes as free text, so URLs are searchable", () => {
    const parsed = query("https://example.com/x");
    assert.deepEqual(parsed.text, ["https://example.com/x"]);
  });

  it("ignores empty terms", () => {
    assert.deepEqual(query("", "  ").text, []);
  });
});

describe("matchesQuery", () => {
  it("does not filter by status when the query names none", () => {
    const entities = build([{ id: "aaaaaaa1" }, { id: "bbbbbbb2", status: "closed" }]);
    assert.deepEqual(matching(entities), ["aaaaaaa1", "bbbbbbb2"]);
  });

  it("narrows to the one status named", () => {
    const entities = build([{ id: "aaaaaaa1" }, { id: "bbbbbbb2", status: "closed" }]);
    assert.deepEqual(matching(entities, "status:open"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "status:closed"), ["bbbbbbb2"]);
  });

  it("ORs statuses, so both can be listed at once", () => {
    const entities = build([{ id: "aaaaaaa1" }, { id: "bbbbbbb2", status: "closed" }]);
    assert.deepEqual(matching(entities, "status:open", "status:closed"), ["aaaaaaa1", "bbbbbbb2"]);
  });

  it("ANDs labels, since an entity carries many", () => {
    const entities = build([
      { id: "aaaaaaa1", labels: ["bug", "auth"] },
      { id: "bbbbbbb2", labels: ["bug"] },
    ]);
    assert.deepEqual(matching(entities, "label:bug"), ["aaaaaaa1", "bbbbbbb2"]);
    assert.deepEqual(matching(entities, "label:bug", "label:auth"), ["aaaaaaa1"]);
  });

  it("matches labels case-insensitively", () => {
    const entities = build([{ id: "aaaaaaa1", labels: ["Bug"] }]);
    assert.deepEqual(matching(entities, "label:bug"), ["aaaaaaa1"]);
  });

  it("ORs authors, since an entity has exactly one", () => {
    const entities = build([
      { id: "aaaaaaa1", author: "alice@example.com" },
      { id: "bbbbbbb2", author: "bob@other.org" },
    ]);
    assert.deepEqual(matching(entities, "author:alice@example.com", "author:bob@other.org"), [
      "aaaaaaa1",
      "bbbbbbb2",
    ]);
    assert.deepEqual(matching(entities, "author:other.org"), ["bbbbbbb2"]);
  });

  it("matches assignees by address or domain fragment", () => {
    const entities = build([{ id: "aaaaaaa1", assignee: "ked@example.com" }, { id: "bbbbbbb2" }]);
    assert.deepEqual(matching(entities, "assignee:ked@example.com"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "assignee:example.com"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "assignee:nobody@example.com"), []);
    assert.deepEqual(matching(entities, "assignee:Ked <ked@example.com>"), ["aaaaaaa1"]);
  });

  it("matches milestones exactly", () => {
    const entities = build([{ id: "aaaaaaa1", milestone: "v1.0" }]);
    assert.deepEqual(matching(entities, "milestone:v1.0"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "milestone:v1"), []);
  });

  it("matches every named feature, so two terms narrow", () => {
    const entities = build([
      { id: "aaaaaaa1", features: ["auth", "mobile"] },
      { id: "bbbbbbb2", features: ["auth"] },
      { id: "ccccccc3" },
    ]);
    assert.deepEqual(matching(entities, "feature:auth"), ["aaaaaaa1", "bbbbbbb2"]);
    assert.deepEqual(matching(entities, "feature:auth", "feature:mobile"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "feature:billing"), []);
    // A query typed with a capital still finds the lowercase slug it means.
    assert.deepEqual(matching(entities, "feature:AUTH"), ["aaaaaaa1", "bbbbbbb2"]);
  });

  it("reads a feature term as a term, not as free text", () => {
    const entities = build([{ id: "aaaaaaa1", body: "feature:auth appears in the body" }]);
    assert.deepEqual(matching(entities, "feature:auth"), []);
    assert.deepEqual(query("feature:auth").features, ["auth"]);
    assert.deepEqual(query("feature:auth").text, []);
    assert.equal(isQueryError(parseQuery(["feature:"], "issue")), true);
  });

  it("searches title, description and comment bodies for free text", () => {
    const entities = build([
      { id: "aaaaaaa1", title: "Timeout on login" },
      { id: "bbbbbbb2", body: "The TIMEOUT is in the load balancer." },
      { id: "ccccccc3", comments: ["traced to an idle timeout"] },
      { id: "ddddddd4", title: "Unrelated", body: "Nothing here." },
    ]);
    assert.deepEqual(matching(entities, "timeout"), ["aaaaaaa1", "bbbbbbb2", "ccccccc3"]);
  });

  it("ANDs free-text terms", () => {
    const entities = build([
      { id: "aaaaaaa1", title: "Login timeout" },
      { id: "bbbbbbb2", title: "Login crash" },
    ]);
    assert.deepEqual(matching(entities, "login", "timeout"), ["aaaaaaa1"]);
  });

  it("combines different keys with AND", () => {
    const entities = build([
      { id: "aaaaaaa1", labels: ["bug"], assignee: "ked@example.com" },
      { id: "bbbbbbb2", labels: ["bug"] },
    ]);
    assert.deepEqual(matching(entities, "label:bug", "assignee:ked@example.com"), ["aaaaaaa1"]);
  });
});

describe("needsComments", () => {
  it("is true only when free text has to be searched", () => {
    assert.equal(needsComments(query("label:bug", "status:open")), false);
    assert.equal(needsComments(query("timeout")), true);
  });

  it("is true for the terms read from the reviews themselves", () => {
    assert.equal(needsComments(prQuery("reviewer:alice@example.com")), false);
    assert.equal(needsComments(prQuery("review:approved")), true);
    assert.equal(needsComments(prQuery("awaiting:alice@example.com")), true);
  });
});

/* ------------------------------------------------------ the review terms */

const HEAD = "1111111111111111111111111111111111111111";
const OLD_HEAD = "2222222222222222222222222222222222222222";
const BASE = "9999999999999999999999999999999999999999";

interface PrSpec {
  id: string;
  reviewer?: string;
  /** `author verdict revision` per review, in the order they were written. */
  reviews?: string[];
  heads?: string[];
}

function buildPrs(specs: PrSpec[]): EntityRecord[] {
  const entries: Record<string, string> = {};
  for (const spec of specs) {
    const dir = `prs/open/${spec.id}-slug`;
    const lines = [
      "---",
      "title: A change",
      "author: ked@example.com",
      "created: 2026-08-04T16:40:00Z",
      "target: main",
    ];
    if (spec.reviewer) lines.push(`reviewer: ${spec.reviewer}`);
    lines.push("revisions:");
    for (const head of spec.heads ?? [HEAD]) {
      lines.push(`  - head: ${head}`, `    base: ${BASE}`, "    date: 2026-08-04T16:40:00Z");
    }
    lines.push("---", "", "Body text.", "");
    entries[`${dir}/pr.md`] = lines.join("\n");
    (spec.reviews ?? []).forEach((review, index) => {
      const [who, verdict, revision] = review.split(" ");
      entries[`${dir}/comments/2026-08-0${index + 3}T141207Z-ccccccc${index + 1}.md`] =
        `---\nauthor: ${who}\nverdict: ${verdict}\nrevision: ${revision ?? HEAD}\n---\n\nSaid so.\n`;
    });
  }
  return parseTree(new Map(Object.entries(entries)) as NavTree).prs;
}

const prQuery = (...terms: string[]): Query => {
  const result = parseQuery(terms, "pr");
  assert.equal(isQueryError(result), false, JSON.stringify(result));
  return result as Query;
};

const prMatching = (entities: EntityRecord[], ...terms: string[]): string[] =>
  entities
    .filter((e) => matchesQuery(prQuery(...terms), e))
    .map((e) => e.id)
    .sort();

/** The same, counted by a policy the marker declared (spec 02 §2.10). */
const prMatchingUnder = (
  entities: EntityRecord[],
  policy: ReviewPolicy,
  ...terms: string[]
): string[] =>
  entities
    .filter((e) => matchesQuery(prQuery(...terms), e, policy))
    .map((e) => e.id)
    .sort();

describe("the review query terms", () => {
  const entities = buildPrs([
    { id: "aaaaaaa1", reviewer: "alice@example.com", reviews: ["alice@example.com approve"] },
    { id: "bbbbbbb2", reviewer: "[alice@example.com, bo@corp.example]" },
    { id: "ccccccc3", reviewer: "bo@corp.example", reviews: ["bo@corp.example request-changes"] },
    { id: "ddddddd4", reviews: ["zoe@example.com approve"] },
    {
      id: "eeeeeee5",
      reviewer: "alice@example.com",
      heads: [OLD_HEAD, HEAD],
      reviews: [`alice@example.com approve ${OLD_HEAD}`],
    },
  ]);

  it("finds the pull requests that asked one person", () => {
    assert.deepEqual(prMatching(entities, "reviewer:alice@example.com"), [
      "aaaaaaa1",
      "bbbbbbb2",
      "eeeeeee5",
    ]);
  });

  it("matches a reviewer written as a named address, as a listing names them", () => {
    assert.deepEqual(prMatching(entities, "reviewer:Alice <alice@example.com>"), [
      "aaaaaaa1",
      "bbbbbbb2",
      "eeeeeee5",
    ]);
  });

  it("matches a reviewer by domain fragment, as assignee does", () => {
    assert.deepEqual(prMatching(entities, "reviewer:corp"), ["bbbbbbb2", "ccccccc3"]);
  });

  it("does not treat a volunteer as somebody who was asked", () => {
    assert.deepEqual(prMatching(entities, "reviewer:zoe@example.com"), []);
  });

  it("ANDs two reviewer terms, since the key holds several", () => {
    assert.deepEqual(
      prMatching(entities, "reviewer:alice@example.com", "reviewer:bo@corp.example"),
      ["bbbbbbb2"],
    );
  });

  it("filters by the decision the reviews add up to", () => {
    assert.deepEqual(prMatching(entities, "review:approved"), ["aaaaaaa1", "ddddddd4"]);
    assert.deepEqual(prMatching(entities, "review:changes-requested"), ["ccccccc3"]);
    assert.deepEqual(prMatching(entities, "review:pending"), ["bbbbbbb2", "eeeeeee5"]);
  });

  it("counts the decision by the declared policy, so a listing agrees with a show", () => {
    const twice: ReviewPolicy = { selfReview: false, minApprovals: 2 };
    // Each of these has one approval, which is enough by default and short of
    // a policy asking for two.
    assert.deepEqual(prMatching(entities, "review:approved"), ["aaaaaaa1", "ddddddd4"]);
    assert.deepEqual(prMatchingUnder(entities, twice, "review:approved"), []);
    assert.deepEqual(prMatchingUnder(entities, twice, "review:pending"), [
      "aaaaaaa1",
      "bbbbbbb2",
      "ddddddd4",
      "eeeeeee5",
    ]);
  });

  it("leaves a block short of nothing, since approvals cannot outvote one", () => {
    const many: ReviewPolicy = { selfReview: false, minApprovals: 5 };
    assert.deepEqual(prMatchingUnder(entities, many, "review:changes-requested"), ["ccccccc3"]);
  });

  it("ORs two decisions, since a pull request has only one", () => {
    assert.deepEqual(prMatching(entities, "review:approved", "review:changes-requested"), [
      "aaaaaaa1",
      "ccccccc3",
      "ddddddd4",
    ]);
  });

  it("finds what one person still owes", () => {
    assert.deepEqual(prMatching(entities, "awaiting:alice@example.com"), ["bbbbbbb2", "eeeeeee5"]);
    assert.deepEqual(prMatching(entities, "awaiting:bo@corp.example"), ["bbbbbbb2"]);
  });

  it("counts a stale approval as still owed, since the revision moved on", () => {
    assert.deepEqual(prMatching(entities, "awaiting:alice@example.com").includes("eeeeeee5"), true);
  });

  it("rejects the review terms on issues, which have no reviews", () => {
    for (const term of ["reviewer:a@b.co", "review:approved", "awaiting:a@b.co"]) {
      const result = parseQuery([term], "issue");
      assert.equal(isQueryError(result), true, term);
      assert.match((result as { message: string }).message, /describes a pull request/);
    }
  });

  it("rejects a decision that does not exist", () => {
    const result = parseQuery(["review:merged"], "pr");
    assert.equal(isQueryError(result), true);
    assert.match((result as { message: string }).message, /unknown review decision 'merged'/);
  });

  it("rejects the review terms with no value, as every keyed term does", () => {
    for (const term of ["reviewer:", "review:", "awaiting:"]) {
      assert.equal(isQueryError(parseQuery([term], "pr")), true, term);
    }
  });
});

/**
 * `deadline:` — the one term an issue has and a pull request does not.
 *
 * The day it is judged against is the caller's, so every case here says which
 * day it means; that is the same thing the CLI does with `NAV_NOW` and the
 * server with its own clock, and it is what makes the answers repeatable.
 */
describe("the deadline query term", () => {
  const TODAY = "2026-09-08";

  const entities = build([
    { id: "aaaaaaa1", deadline: "2026-09-06" },
    { id: "bbbbbbb2", deadline: TODAY },
    { id: "ccccccc3", deadline: "2026-09-09" },
    { id: "ddddddd4" },
  ]);

  const dueMatching = (...terms: string[]): string[] =>
    entities
      .filter((e) => matchesQuery({ ...query(...terms), today: TODAY }, e))
      .map((e) => e.id)
      .sort();

  it("finds what is past its day, and counts today as not yet late", () => {
    assert.deepEqual(dueMatching("deadline:overdue"), ["aaaaaaa1"]);
  });

  it("finds what has no day at all", () => {
    assert.deepEqual(dueMatching("deadline:none"), ["ddddddd4"]);
  });

  it("ORs its terms, as every single-valued key does", () => {
    assert.deepEqual(dueMatching("deadline:overdue", "deadline:none"), ["aaaaaaa1", "ddddddd4"]);
  });

  it("ANDs with other keys, as every term does", () => {
    const mixed = build([
      { id: "aaaaaaa1", deadline: "2026-09-06", labels: ["bug"] },
      { id: "bbbbbbb2", deadline: "2026-09-06" },
    ]);
    assert.deepEqual(
      mixed
        .filter((e) => matchesQuery({ ...query("deadline:overdue", "label:bug"), today: TODAY }, e))
        .map((e) => e.id),
      ["aaaaaaa1"],
    );
  });

  it("treats a deadline it cannot read as none, so a bad line never hides work", () => {
    const broken = build([{ id: "aaaaaaa1", deadline: "someday" }]);
    assert.deepEqual(
      broken
        .filter((e) => matchesQuery({ ...query("deadline:none"), today: TODAY }, e))
        .map((e) => e.id),
      ["aaaaaaa1"],
    );
  });

  it("says so rather than matching nothing when no day was supplied", () => {
    // A caller that forgot, not a query somebody typed: a listing that looks
    // answered and is not would be the worse of the two failures.
    assert.throws(
      () => matchesQuery(query("deadline:overdue"), entities[0] as EntityRecord),
      /needs the day to judge it against/,
    );
  });

  it("needs no day for `none`, which asks nothing about today", () => {
    assert.equal(matchesQuery(query("deadline:none"), entities[3] as EntityRecord), true);
  });

  it("costs no reading of the comments, unlike the derived terms", () => {
    assert.equal(needsComments(query("deadline:overdue")), false);
  });

  it("rejects the term on pull requests, which are not scheduled", () => {
    const result = parseQuery(["deadline:overdue"], "pr");
    assert.equal(isQueryError(result), true);
    assert.match((result as { message: string }).message, /describes an issue/);
  });

  it("rejects a term that is neither overdue nor none", () => {
    const result = parseQuery(["deadline:soon"], "issue");
    assert.equal(isQueryError(result), true);
    assert.match((result as { message: string }).message, /unknown deadline term 'soon'/);
  });

  it("rejects the term with no value, as every keyed term does", () => {
    assert.equal(isQueryError(parseQuery(["deadline:"], "issue")), true);
  });
});
