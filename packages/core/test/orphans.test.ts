import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NavTree } from "../src/core/tree.ts";
import { parseTree } from "../src/core/tree.ts";
import { validateTree } from "../src/core/validate.ts";

const issue = "---\ntitle: T\nauthor: a@b.co\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n";
const comment = "---\nauthor: b@c.co\n---\n\nStranded.\n";

const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));

describe("orphaned entity directories", () => {
  it("records a well-named directory that holds comments but no entity file", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md": comment,
      }),
    );
    assert.equal(repo.orphans.length, 1);
    assert.deepEqual(repo.orphans[0]?.id, "bqlybac0");
    assert.deepEqual(repo.orphans[0]?.commentPaths, [
      "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md",
    ]);
  });

  it("offers a fix that reunites the comments with the entity's real location", () => {
    const diagnostics = validateTree(
      tree({
        "issues/closed/bqlybac0-x/issue.md": issue,
        "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md": comment,
      }),
    );
    assert.equal(diagnostics.length, 1);
    const diagnostic = diagnostics[0]!;
    assert.equal(diagnostic.check, "D1");
    assert.deepEqual(diagnostic.fix, [
      {
        op: "move",
        from: "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md",
        to: "issues/closed/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md",
      },
    ]);
  });

  it("moves every stranded comment, not just the first", () => {
    const diagnostics = validateTree(
      tree({
        "issues/closed/bqlybac0-x/issue.md": issue,
        "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md": comment,
        "issues/open/bqlybac0-x/comments/2026-08-06T100000Z-ddd22222.md": comment,
      }),
    );
    assert.equal(diagnostics[0]?.fix?.length, 2);
  });

  it("offers no fix when the entity exists nowhere, since the move has no target", () => {
    const diagnostics = validateTree(
      tree({ "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md": comment }),
    );
    assert.equal(diagnostics[0]?.check, "D1");
    assert.equal(diagnostics[0]?.fix, undefined);
  });

  it("offers no fix when the id belongs to the other entity kind", () => {
    const diagnostics = validateTree(
      tree({
        "prs/open/bqlybac0-x/pr.md":
          "---\ntitle: T\nauthor: a@b.co\ncreated: 2026-08-02T09:14:00Z\ntarget: main\nrevisions:\n  - head: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d\n    base: 91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0\n    date: 2026-08-02T09:14:00Z\n---\n\nBody.\n",
        "issues/open/bqlybac0-x/comments/2026-08-05T100000Z-ccc11111.md": comment,
      }),
    );
    const orphanDiagnostic = diagnostics.find((d) => d.path === "issues/open/bqlybac0-x");
    assert.equal(orphanDiagnostic?.fix, undefined);
  });

  it("offers no fix for an empty orphaned directory", () => {
    const repo = parseTree(tree({ "issues/open/bqlybac0-x/stray.txt": "not a comment" }));
    assert.equal(repo.orphans[0]?.commentPaths.length, 0);
  });
});
