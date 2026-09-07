/**
 * The derived review state of spec 02 §2.7.
 *
 * Every case here is a reading of files that could have been written by hand,
 * because that is the claim the format makes: `nav pr request` and `nav pr
 * review` are conveniences over frontmatter anybody may type themselves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, isAwaiting, latestRevision, reviewSummary } from "../src/core/review.ts";
import { type EntityRecord, type NavTree, parseTree } from "../src/core/tree.ts";

const HEAD_1 = "1111111111111111111111111111111111111111";
const HEAD_2 = "2222222222222222222222222222222222222222";
const BASE = "9999999999999999999999999999999999999999";

interface ReviewSpec {
  /** Comment author. */
  who: string;
  verdict?: string;
  revision?: string;
  /** Distinguishes files; any two comments must sort in the order given. */
  at?: string;
}

interface PrSpec {
  author?: string;
  reviewer?: string;
  heads?: string[];
  reviews?: ReviewSpec[];
}

let nextId = 0;

function build(spec: PrSpec): EntityRecord {
  const dir = "prs/open/dk3mp2x9-a-pull-request";
  const heads = spec.heads ?? [HEAD_1];
  const lines = [
    "---",
    "title: A pull request",
    `author: ${spec.author ?? "ked@example.com"}`,
    "created: 2026-08-04T16:40:00Z",
    "target: main",
    "source: feat/x",
  ];
  if (spec.reviewer !== undefined) lines.push(`reviewer: ${spec.reviewer}`);
  lines.push("revisions:");
  for (const head of heads) {
    lines.push(`  - head: ${head}`, `    base: ${BASE}`, "    date: 2026-08-04T16:40:00Z");
  }
  lines.push("---", "", "What it proposes.", "");

  const entries: Record<string, string> = { [`${dir}/pr.md`]: lines.join("\n") };
  (spec.reviews ?? []).forEach((review, index) => {
    nextId += 1;
    const id = `c${String(nextId).padStart(6, "0")}1`;
    const stamp = review.at ?? `2026-08-05T1${index}0000Z`;
    const fm = ["---", `author: ${review.who}`];
    if (review.verdict !== undefined) fm.push(`verdict: ${review.verdict}`);
    if (review.revision !== undefined) fm.push(`revision: ${review.revision}`);
    fm.push("---", "", "Said something.", "");
    entries[`${dir}/comments/${stamp}-${id}.md`] = fm.join("\n");
  });
  const pr = parseTree(new Map(Object.entries(entries)) as NavTree).prs[0];
  assert.ok(pr, "fixture built no pull request");
  return pr;
}

/** The summary as a comparable shape: who, what they said, and whether they were asked. */
const rows = (entity: EntityRecord): string[] =>
  reviewSummary(entity).reviewers.map(
    (entry) => `${entry.person} ${entry.state}${entry.volunteer ? " (volunteer)" : ""}`,
  );

describe("latestRevision", () => {
  it("is the last entry, since the list is append-only", () => {
    assert.equal(latestRevision(build({ heads: [HEAD_1, HEAD_2] }).fm), HEAD_2);
  });

  it("is absent when nothing is recorded", () => {
    assert.equal(latestRevision({}), undefined);
  });
});

describe("reviewSummary", () => {
  it("reports a person nobody has heard from as pending", () => {
    const pr = build({ reviewer: "alice@example.com" });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
    assert.equal(reviewSummary(pr).decision, "pending");
  });

  it("reads a verdict bound to the latest revision", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com approve"]);
    assert.equal(reviewSummary(pr).decision, "approved");
  });

  it("ignores a verdict bound to a superseded revision", () => {
    const pr = build({
      reviewer: "alice@example.com",
      heads: [HEAD_1, HEAD_2],
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
    assert.equal(reviewSummary(pr).decision, "pending");
  });

  it("reports the revision the states were read against", () => {
    assert.equal(reviewSummary(build({ heads: [HEAD_1, HEAD_2] })).revision, HEAD_2);
  });

  it("counts a review nobody asked for, and marks it as one", () => {
    const pr = build({
      reviews: [{ who: "zoe@example.com", verdict: "request-changes", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["zoe@example.com request-changes (volunteer)"]);
    assert.equal(reviewSummary(pr).decision, "changes-requested");
  });

  it("does not mark somebody a volunteer for answering the request made of them", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.equal(reviewSummary(pr).reviewers[0]?.volunteer, false);
  });

  it("lists everyone asked before whoever turned up", () => {
    const pr = build({
      reviewer: "[alice@example.com, bob@example.com]",
      reviews: [{ who: "zoe@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), [
      "alice@example.com pending",
      "bob@example.com pending",
      "zoe@example.com approve (volunteer)",
    ]);
  });

  it("takes a person's latest opinion on the revision", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [
        {
          who: "alice@example.com",
          verdict: "request-changes",
          revision: HEAD_1,
          at: "2026-08-05T100000Z",
        },
        {
          who: "alice@example.com",
          verdict: "approve",
          revision: HEAD_1,
          at: "2026-08-06T100000Z",
        },
      ],
    });
    assert.deepEqual(rows(pr), ["alice@example.com approve"]);
  });

  it("does not let a comment verdict retract an opinion its author already gave", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [
        {
          who: "alice@example.com",
          verdict: "approve",
          revision: HEAD_1,
          at: "2026-08-05T100000Z",
        },
        {
          who: "alice@example.com",
          verdict: "comment",
          revision: HEAD_1,
          at: "2026-08-06T100000Z",
        },
      ],
    });
    assert.deepEqual(rows(pr), ["alice@example.com approve"]);
    assert.equal(reviewSummary(pr).decision, "approved");
  });

  it("upgrades a comment verdict when its author later takes a side", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [
        {
          who: "alice@example.com",
          verdict: "comment",
          revision: HEAD_1,
          at: "2026-08-05T100000Z",
        },
        {
          who: "alice@example.com",
          verdict: "request-changes",
          revision: HEAD_1,
          at: "2026-08-06T100000Z",
        },
      ],
    });
    assert.deepEqual(rows(pr), ["alice@example.com request-changes"]);
  });

  it("counts a comment verdict as an answer, not as a judgement", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "comment", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com commented"]);
    assert.equal(reviewSummary(pr).decision, "pending");
  });

  it("ignores a comment carrying no verdict at all", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
  });

  it("ignores a verdict that binds to no revision, which is a schema fault anyway", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "approve" }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
  });

  it("matches a revision case-insensitively, as git does", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1.toUpperCase() }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com approve"]);
  });

  it("names one person once however their address is spelled", () => {
    const pr = build({
      reviewer: "Alice Smith <alice@example.com>",
      reviews: [{ who: "ALICE@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["Alice Smith <alice@example.com> approve"]);
  });

  it("folds a person listed twice under two spellings", () => {
    const pr = build({ reviewer: "[alice@example.com, Alice <alice@example.com>]" });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
  });

  it("ignores the author's own verdict, and never lists them", () => {
    const pr = build({
      author: "ked@example.com",
      reviewer: "alice@example.com",
      reviews: [{ who: "ked@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.deepEqual(rows(pr), ["alice@example.com pending"]);
    assert.equal(reviewSummary(pr).decision, "pending");
  });

  it("ignores the author even when a hand-edit asks them to review", () => {
    const pr = build({ author: "Ked <ked@example.com>", reviewer: "ked@example.com" });
    assert.deepEqual(rows(pr), []);
  });

  it("lets a block outrank an approval whoever arrived first", () => {
    const both = (first: string, second: string): string =>
      reviewSummary(
        build({
          reviewer: "[alice@example.com, bob@example.com]",
          reviews: [
            {
              who: "alice@example.com",
              verdict: first,
              revision: HEAD_1,
              at: "2026-08-05T100000Z",
            },
            { who: "bob@example.com", verdict: second, revision: HEAD_1, at: "2026-08-06T100000Z" },
          ],
        }),
      ).decision;
    assert.equal(both("approve", "request-changes"), "changes-requested");
    assert.equal(both("request-changes", "approve"), "changes-requested");
  });

  it("does not let one person's silence withhold another's approval", () => {
    const pr = build({
      reviewer: "[alice@example.com, bob@example.com]",
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.equal(reviewSummary(pr).decision, "approved");
    assert.deepEqual(rows(pr), ["alice@example.com approve", "bob@example.com pending"]);
  });

  it("names the review a state was read from", () => {
    const pr = build({
      reviewer: "alice@example.com",
      reviews: [{ who: "alice@example.com", verdict: "approve", revision: HEAD_1 }],
    });
    const entry = reviewSummary(pr).reviewers[0];
    assert.match(String(entry?.commentId), /^[a-z][a-z0-9]{7}$/);
  });

  it("survives a pull request with no revisions, which doctor reports separately", () => {
    const pr = build({ heads: [], reviewer: "alice@example.com" });
    assert.deepEqual(reviewSummary(pr), {
      reviewers: [{ person: "alice@example.com", state: "pending", volunteer: false }],
      decision: "pending",
    });
  });

  it("reports nothing for a pull request nobody was asked to review", () => {
    assert.deepEqual(reviewSummary(build({})), {
      revision: HEAD_1,
      reviewers: [],
      decision: "pending",
    });
  });

  it("keeps a malformed reviewer entry visible rather than dropping it", () => {
    // `nobody` is not an address, so D2 reports the file — but a reader that
    // silently omitted the entry would hide the very thing that needs fixing.
    const pr = build({ reviewer: "nobody" });
    assert.deepEqual(rows(pr), ["nobody pending"]);
  });
});

describe("decide", () => {
  it("prefers a block to an approval, and an approval to silence", () => {
    const state = (...states: string[]) =>
      decide(states.map((s) => ({ person: "x@y.zz", state: s as never, volunteer: false })));
    assert.equal(state(), "pending");
    assert.equal(state("pending", "commented"), "pending");
    assert.equal(state("commented", "approve"), "approved");
    assert.equal(state("approve", "request-changes"), "changes-requested");
  });
});

describe("isAwaiting", () => {
  const pr = build({
    reviewer: "[alice@example.com, bob@corp.example.com]",
    reviews: [
      { who: "alice@example.com", verdict: "approve", revision: HEAD_1 },
      { who: "zoe@example.com", verdict: "comment", revision: HEAD_1 },
    ],
  });

  it("is true for somebody asked who has not answered", () => {
    assert.equal(isAwaiting(reviewSummary(pr), "bob@corp.example.com"), true);
  });

  it("is false once they have answered", () => {
    assert.equal(isAwaiting(reviewSummary(pr), "alice@example.com"), false);
  });

  it("is false once they have answered with a verdict that judges nothing", () => {
    // The whole point of the third verdict: it says the revision was read, so
    // the request it answers is no longer outstanding (§2.6).
    const answered = build({
      reviewer: "bob@corp.example.com",
      reviews: [{ who: "bob@corp.example.com", verdict: "comment", revision: HEAD_1 }],
    });
    assert.equal(isAwaiting(reviewSummary(answered), "bob@corp.example.com"), false);
    assert.equal(reviewSummary(answered).decision, "pending", "and it still judges nothing");
  });

  it("is true again once a new revision supersedes the answer", () => {
    const moved = build({
      reviewer: "bob@corp.example.com",
      heads: [HEAD_1, HEAD_2],
      reviews: [{ who: "bob@corp.example.com", verdict: "approve", revision: HEAD_1 }],
    });
    assert.equal(isAwaiting(reviewSummary(moved), "bob@corp.example.com"), true);
  });

  it("is false for a volunteer, who was never asked", () => {
    assert.equal(isAwaiting(reviewSummary(pr), "zoe@example.com"), false);
  });

  it("matches a domain fragment, as the query grammar does elsewhere", () => {
    assert.equal(isAwaiting(reviewSummary(pr), "corp"), true);
  });

  it("is false for somebody with nothing to do with it", () => {
    assert.equal(isAwaiting(reviewSummary(pr), "nobody@example.com"), false);
  });
});
