// Run once, while the API image is built, from the directory the server and
// its plugins were installed into.
//
// The install passes `--legacy-peer-deps`, as `nav plugin install` does, so npm
// does not refuse a plugin over the optional peers of its web half. That also
// stops npm checking the one peer that matters here: `@navbook/core`, which the
// image provides as the tarball installed beside the server. So it is checked
// here instead, with core's own reading of a range. A plugin built for another
// core fails the build, rather than failing at start or, worse, half-working.

import { readFileSync } from "node:fs";
import { hasPluginKeyword, satisfiesRange } from "@navbook/core";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const installed = read("package.json").dependencies ?? {};
const core = read("node_modules/@navbook/core/package.json").version;

const faults = [];
for (const name of Object.keys(installed)) {
  const pkg = read(`node_modules/${name}/package.json`);
  if (!hasPluginKeyword(pkg)) continue;
  const range = pkg.peerDependencies?.["@navbook/core"];
  if (range !== undefined && !satisfiesRange(range, core)) {
    faults.push(`${name}@${pkg.version} needs @navbook/core ${range}, and this image has ${core}`);
  }
}

if (faults.length > 0) {
  for (const fault of faults) console.error(`NAVBOOK_PLUGINS: ${fault}`);
  process.exit(1);
}
