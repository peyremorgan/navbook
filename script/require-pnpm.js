/**
 * Refuse to publish with anything but pnpm.
 *
 * Both packages describe themselves twice: `exports` points at TypeScript
 * sources so the workspace needs no build step, and `publishConfig.exports`
 * points at `dist/` for anyone installing from the registry. pnpm applies the
 * second at pack time and rewrites `workspace:` dependencies to real versions;
 * npm does neither (npm/cli#7586). Publishing with npm would therefore ship a
 * package whose entry point is a `.ts` file that is not even in the tarball.
 */

const agent = process.env.npm_config_user_agent ?? "";
if (!/\bpnpm\//.test(agent)) {
  console.error(
    "refusing to publish: use pnpm.\n" +
      "npm does not apply publishConfig.exports or rewrite workspace: dependencies,\n" +
      "so the published package would point at sources that are not shipped.",
  );
  process.exit(1);
}
