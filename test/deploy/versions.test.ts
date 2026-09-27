/**
 * That the published packages still agree on one version.
 *
 * They are released in lockstep (spec 05 §5.2), and the release workflow
 * refuses a tag that does not match every one of them — but only once the tag
 * is pushed, which is the worst moment to find out. This asks the same
 * question of the working tree, taking the list of packages from the
 * workflow itself so the two cannot drift apart.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";
import { satisfiesRange } from "../../packages/core/src/core/plugins.ts";

interface Manifest {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
}

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8")) as Manifest;
}

/** The packages whose version the release workflow holds the tag against. */
function releasedPackages(): string[] {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
  const loop = /for pkg in ([a-z -]+); do/.exec(workflow);
  assert.ok(loop, "release.yml no longer names its packages in a `for pkg in … ; do` loop");
  return (loop[1] as string).trim().split(/\s+/);
}

describe("the released packages", () => {
  const root = manifest(".").version;
  const released = releasedPackages();

  it("include the knowledge base", () => {
    assert.ok(released.includes("plugin-kb"), released.join(", "));
  });

  for (const pkg of released) {
    it(`@navbook/${pkg} carries the workspace's version`, () => {
      assert.equal(manifest(join("packages", pkg)).version, root);
    });
  }

  it("each accept the core they are released beside", () => {
    for (const pkg of released) {
      const range = manifest(join("packages", pkg)).peerDependencies?.["@navbook/core"];
      if (range === undefined) continue;
      assert.ok(
        satisfiesRange(range, root),
        `@navbook/${pkg} asks for @navbook/core ${range}, which ${root} does not satisfy`,
      );
    }
  });
});
