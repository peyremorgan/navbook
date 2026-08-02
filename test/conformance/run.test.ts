/**
 * Runs every fixture in `doc/spec/fixtures/` against `$NAV_BIN`.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PROJECT_ROOT } from "../helpers/temprepo.ts";
import { discoverCases, readManifest, runCase } from "./harness.ts";

const FIXTURE_ROOT = join(PROJECT_ROOT, "doc", "spec", "fixtures");

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
    it(name, () => {
      const manifest = readManifest(caseDir);
      const result = runCase(caseDir);
      assert.deepEqual(
        result.failures,
        [],
        `${manifest.description ?? name}\n\n${result.failures.join("\n\n")}`,
      );
    });
  }
});
