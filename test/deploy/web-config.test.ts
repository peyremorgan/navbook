/**
 * What the web container writes before nginx starts.
 *
 * `config.json` is the one file a deployment overwrites, and the app parses it
 * strictly on purpose — so the assertion worth making is not that the script
 * produced some JSON, but that the app's own parser accepts what it produced.
 * `parseConfig` is imported rather than described for exactly that reason.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";
import { parseConfig } from "../../packages/web/app/utils/config.ts";
import { runWebConfig } from "./helpers.ts";

const COMPLETE = {
  NAVBOOK_GRAPHQL_URL: "https://api.navbook.example.com/graphql",
  NAVBOOK_OIDC_ISSUER: "https://accounts.example.com",
  NAVBOOK_OIDC_CLIENT_ID: "navbook-web",
  NAVBOOK_OIDC_AUDIENCE: "navbook",
};

/** A directory standing in for the generated bundle. */
function bundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "navbook-web-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Read what the script wrote, through the parser the app itself uses. */
function written(root: string) {
  return parseConfig(JSON.parse(readFileSync(join(root, "config.json"), "utf8")));
}

describe("the web container's configuration", () => {
  it("writes a file the app accepts", () => {
    const root = bundle();
    const result = runWebConfig(root, COMPLETE);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(written(root), {
      graphqlUrl: "https://api.navbook.example.com/graphql",
      oidc: {
        issuer: "https://accounts.example.com",
        clientId: "navbook-web",
        audience: "navbook",
      },
    });
  });

  it("replaces the development addresses the bundle ships with", () => {
    const root = bundle();
    writeFileSync(
      join(root, "config.json"),
      JSON.stringify({
        graphqlUrl: "http://localhost:4000/graphql",
        oidc: { issuer: "http://localhost:9000", clientId: "navbook-web", audience: "navbook" },
      }),
    );

    assert.equal(runWebConfig(root, COMPLETE).code, 0);

    assert.equal(written(root).graphqlUrl, COMPLETE.NAVBOOK_GRAPHQL_URL);
    assert.equal(written(root).oidc.issuer, COMPLETE.NAVBOOK_OIDC_ISSUER);
  });

  it("survives a value carrying a quote or a backslash", () => {
    const root = bundle();
    const awkward = { ...COMPLETE, NAVBOOK_OIDC_CLIENT_ID: 'a "quoted" \\ client' };

    assert.equal(runWebConfig(root, awkward).code, 0);

    assert.equal(written(root).oidc.clientId, 'a "quoted" \\ client');
  });

  it("does not let a value run as shell", () => {
    const root = bundle();
    const injected = { ...COMPLETE, NAVBOOK_GRAPHQL_URL: "https://ex.test/$HOME/`id`/graphql" };

    assert.equal(runWebConfig(root, injected).code, 0);

    assert.equal(written(root).graphqlUrl, "https://ex.test/$HOME/`id`/graphql");
  });

  for (const missing of Object.keys(COMPLETE)) {
    it(`stops the container when ${missing} is not set`, () => {
      const root = bundle();
      const result = runWebConfig(root, { ...COMPLETE, [missing]: undefined });

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`${missing} is required`));
      assert.equal(existsSync(join(root, "config.json")), false);
    });

    it(`leaves no stale config behind when ${missing} is not set`, () => {
      const root = bundle();
      writeFileSync(join(root, "config.json"), '{"graphqlUrl":"http://localhost:4000/graphql"}');

      const result = runWebConfig(root, { ...COMPLETE, [missing]: undefined });

      assert.notEqual(result.code, 0);
      assert.equal(
        existsSync(join(root, "config.json")),
        false,
        "yesterday's addresses were left in place, and nothing about that looks wrong",
      );
    });

    it(`stops the container when ${missing} is empty`, () => {
      const root = bundle();
      const result = runWebConfig(root, { ...COMPLETE, [missing]: "" });

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`${missing} is required`));
    });
  }

  it("says what is wrong with a value holding a line break, rather than writing broken JSON", () => {
    const root = bundle();
    const result = runWebConfig(root, { ...COMPLETE, NAVBOOK_OIDC_ISSUER: "https://a\nhttps://b" });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /must not contain a line break/);
    assert.equal(existsSync(join(root, "config.json")), false);
  });

  it("says so when there is no bundle to configure", () => {
    const root = join(bundle(), "not-here");
    const result = runWebConfig(root, COMPLETE);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /nothing to configure/);
  });
});

/**
 * The nginx rules are written against what `nuxi generate` emits, so they are
 * only as true as that. This is what notices when it stops being.
 */
describe("what the file server is configured to serve", { skip: bundleMissing() }, () => {
  const generated = join(REPO_ROOT, "packages", "web", ".output", "public");

  it("has the SPA fallback the try_files rule ends at", () => {
    assert.ok(existsSync(join(generated, "200.html")));
  });

  it("has the directory indexes the try_files rule prefers over it", () => {
    assert.ok(existsSync(join(generated, "issues", "index.html")));
    assert.ok(existsSync(join(generated, "features", "index.html")));
  });

  it("has the hashed assets the long cache is for", () => {
    assert.ok(existsSync(join(generated, "_nuxt")));
  });

  it("ships a config.json for the start-up script to overwrite", () => {
    assert.ok(existsSync(join(generated, "config.json")));
  });
});

/** The bundle is a build artefact; `pnpm --filter @navbook/web build` makes it. */
function bundleMissing(): string | false {
  const generated = join(REPO_ROOT, "packages", "web", ".output", "public");
  return existsSync(generated) ? false : "the web bundle is not built";
}
