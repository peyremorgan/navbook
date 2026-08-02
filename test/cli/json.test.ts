/**
 * The `--json` contract of spec 04 §4.2.
 *
 * These shapes are what agents and the future Rust implementation are compared
 * against, so their stability matters more than their prettiness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeNavRepo, type TempRepo } from "../helpers/temprepo.ts";

/** The escape byte that starts every ANSI sequence. */
const ESC = String.fromCharCode(27);

function lines(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function seeded(): TempRepo {
  const repo = makeNavRepo();
  repo.nav(
    [
      "issue",
      "open",
      "Login times out",
      "-m",
      "Body text.",
      "--label",
      "bug",
      "--label",
      "auth",
      "--commit",
    ],
    { NAV_IDS: "bqlybac0", NAV_NOW: "2026-08-02T09:14:00Z" },
  );
  repo.nav(["issue", "comment", "bqly", "-m", "Reproduced.", "--commit"], {
    NAV_IDS: "t5kr1gq6",
    NAV_NOW: "2026-08-03T14:12:07Z",
  });
  repo.nav(["issue", "open", "Second issue", "-m", "Body.", "--commit"], {
    NAV_IDS: "mz4kq1rv",
    NAV_NOW: "2026-08-04T09:00:00Z",
  });
  return repo;
}

describe("--json", () => {
  it("emits one object per line, with identity keys first", () => {
    const repo = seeded();
    try {
      const out = repo.nav(["issue", "list", "--json"]).stdout;
      const objects = lines(out);
      assert.equal(objects.length, 2);
      assert.equal(out.endsWith("\n"), true, "newline-terminated so it appends cleanly");

      const keys = Object.keys(objects[0] as object);
      assert.deepEqual(keys.slice(0, 5), ["id", "slug", "kind", "status", "path"]);
      assert.equal(objects[0]?.path, ".navbook/issues/open/mz4kq1rv-second-issue");
    } finally {
      repo.cleanup();
    }
  });

  it("mirrors frontmatter in file order, then the body", () => {
    const repo = seeded();
    try {
      const entry = lines(repo.nav(["issue", "list", "--json"]).stdout).find(
        (o) => o.id === "bqlybac0",
      );
      assert.deepEqual(entry?.labels, ["bug", "auth"]);
      assert.equal(entry?.title, "Login times out");
      assert.equal(entry?.body, "Body text.");
      const keys = Object.keys(entry as object);
      assert.ok(keys.indexOf("title") < keys.indexOf("labels"), "frontmatter keeps file order");
      assert.equal(keys[keys.length - 1], "body", "the body comes last");
    } finally {
      repo.cleanup();
    }
  });

  it("keeps `comments` a count-free array only where it exists, never changing type", () => {
    const repo = seeded();
    try {
      const listed = lines(repo.nav(["issue", "list", "--json"]).stdout);
      assert.equal("comments" in (listed[0] as object), false, "list never carries comments");

      const shown = JSON.parse(repo.nav(["issue", "show", "bqly", "--json"]).stdout) as {
        comments: Record<string, unknown>[];
      };
      assert.ok(Array.isArray(shown.comments));
      assert.equal(shown.comments.length, 1);
      assert.equal(shown.comments[0]?.id, "t5kr1gq6");
      assert.equal(shown.comments[0]?.body, "Reproduced.");
      assert.equal(shown.comments[0]?.created, "2026-08-03T141207Z");
    } finally {
      repo.cleanup();
    }
  });

  it("prints nothing at all when a query matches nothing", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "list", "label:nope", "--json"]);
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "", "empty output, not an empty array or a message");
    } finally {
      repo.cleanup();
    }
  });

  it("is never colored, even when colors are forced on", () => {
    const repo = seeded();
    try {
      const out = repo.nav(["issue", "list", "--json"], { FORCE_COLOR: "3" }).stdout;
      assert.equal(out.includes(ESC), false, "no ANSI escapes in machine output");
      assert.doesNotThrow(() => lines(out));
    } finally {
      repo.cleanup();
    }
  });

  it("marks archived entities and omits the flag otherwise", () => {
    const repo = seeded();
    try {
      repo.write(
        ".navbook/archive/2024/issues/closed/arc11111-old/issue.md",
        "---\ntitle: Old\nauthor: a@b.co\ncreated: 2024-01-01T00:00:00Z\nimported-from: github:acme/repo#1\n---\n\nBody.\n",
      );
      repo.commitAll("chore: archive");
      const archived = lines(repo.nav(["issue", "list", "status:closed", "--json"]).stdout);
      assert.equal(archived[0]?.archived, true);
      const open = lines(repo.nav(["issue", "list", "--json"]).stdout);
      assert.equal("archived" in (open[0] as object), false);
    } finally {
      repo.cleanup();
    }
  });

  it("gives doctor diagnostics a stable shape", () => {
    const repo = seeded();
    try {
      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      const objects = lines(repo.nav(["doctor", "--json"]).stdout);
      assert.deepEqual(Object.keys(objects[0] as object), ["check", "level", "path", "message"]);
    } finally {
      repo.cleanup();
    }
  });
});
