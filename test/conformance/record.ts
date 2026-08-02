/**
 * Maintenance tool: regenerate fixture expectations.
 *
 *   node test/conformance/record.ts [case-dir ...]
 *
 * With no arguments it re-records every fixture. Recorded output encodes what
 * the implementation currently does — always read the diff and check it against
 * the specification before committing it.
 */

import { join } from "node:path";
import { PROJECT_ROOT } from "../helpers/temprepo.ts";
import { discoverCases, recordCase } from "./harness.ts";

const FIXTURE_ROOT = join(PROJECT_ROOT, "doc", "spec", "fixtures");
const targets = process.argv.slice(2);
const cases = targets.length > 0 ? targets : discoverCases(FIXTURE_ROOT);

let failed = 0;
for (const caseDir of cases) {
  try {
    const { code, wrote } = recordCase(caseDir);
    const name = caseDir.replace(`${FIXTURE_ROOT}/`, "");
    console.log(`recorded ${name} (exit ${code}, ${wrote.length} file(s))`);
  } catch (error) {
    failed++;
    console.error(`FAILED ${caseDir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exitCode = failed === 0 ? 0 : 1;
