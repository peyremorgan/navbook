import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  });

  it("matches milestones exactly", () => {
    const entities = build([{ id: "aaaaaaa1", milestone: "v1.0" }]);
    assert.deepEqual(matching(entities, "milestone:v1.0"), ["aaaaaaa1"]);
    assert.deepEqual(matching(entities, "milestone:v1"), []);
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
});
