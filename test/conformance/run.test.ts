/**
 * Runs every fixture in `doc/spec/fixtures/` against `$NAV_BIN`.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";
import { discoverCases, readManifest, runCase, skipsPlugins } from "./harness.ts";

const FIXTURE_ROOT = join(REPO_ROOT, "doc", "spec", "fixtures");

const cases = discoverCases(FIXTURE_ROOT);

describe("conformance fixtures", () => {
  it("finds fixtures to run", () => {
    assert.ok(cases.length > 0, `no fixtures found under ${FIXTURE_ROOT}`);
  });

  for (const caseDir of cases) {
    const name = caseDir
      .slice(FIXTURE_ROOT.length + 1)
      .split(/[\\/]/)
      .join("/");
    const manifest = readManifest(caseDir);
    const skip = skipsPlugins() && (manifest.plugins?.length ?? 0) > 0;
    it(name, { skip }, () => {
      const result = runCase(caseDir);
      assert.deepEqual(
        result.failures,
        [],
        `${manifest.description ?? name}\n\n${result.failures.join("\n\n")}`,
      );
    });
  }
});
