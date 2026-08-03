/**
 * Refuse to build a release artifact with anything but pnpm.
 *
 * Both packages describe themselves twice: `exports` points at TypeScript
 * sources so the workspace needs no build step, and `publishConfig.exports`
 * points at `dist/` for anyone installing from the registry. pnpm applies the
 * second when it packs, and rewrites `workspace:` dependencies to real
 * versions; npm does neither (npm/cli#7586). `npm publish` run against a
 * package directory would therefore upload a package whose entry point is a
 * `.ts` file that is not even in the tarball.
 *
 * Uploading a *finished* tarball with npm is fine and is what the release
 * workflow does — by then both rewrites have already happened, and npm is the
 * only one of the two that can sign a publish with provenance.
 */

const agent = process.env.npm_config_user_agent ?? "";
if (!/\bpnpm\//.test(agent)) {
  console.error(
    "refusing to publish this directory with npm.\n" +
      "npm applies neither publishConfig.exports nor the workspace: rewrite, so the\n" +
      "package would point at sources it does not ship. Build the tarball with\n" +
      "'pnpm --filter <pkg> pack', then upload that with 'npm publish <tarball>'.",
  );
  process.exit(1);
}
