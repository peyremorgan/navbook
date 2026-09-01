/**
 * Reading the configuration, from flags and from the environment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../../src/config.ts";

const REQUIRED = ["--oidc-issuer", "https://issuer.example", "--oidc-audience", "navbook"] as const;

describe("loadConfig", () => {
  it("reads the required options from flags", () => {
    const config = loadConfig({}, [...REQUIRED]);
    assert.equal(config.issuer, "https://issuer.example");
    assert.equal(config.audience, "navbook");
  });

  it("reads them from the environment when no flag is given", () => {
    const config = loadConfig(
      {
        NAV_SERVER_OIDC_ISSUER: "https://from-env.example",
        NAV_SERVER_OIDC_AUDIENCE: "env-audience",
      },
      [],
    );
    assert.equal(config.issuer, "https://from-env.example");
    assert.equal(config.audience, "env-audience");
  });

  it("prefers a flag over the environment", () => {
    const config = loadConfig({ NAV_SERVER_OIDC_ISSUER: "https://ignored.example" }, [...REQUIRED]);
    assert.equal(config.issuer, "https://issuer.example");
  });

  it("says which required option is missing", () => {
    assert.throws(
      () => loadConfig({}, []),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /--oidc-issuer/);
        return true;
      },
    );
  });

  it("defaults the port, remote, staleness window and explorer", () => {
    const config = loadConfig({}, [...REQUIRED]);
    assert.equal(config.port, 4000);
    assert.equal(config.remote, "origin");
    assert.equal(config.pullIntervalMs, 10_000);
    assert.equal(config.graphiql, true);
  });

  it("accepts port 0, which asks for any free one", () => {
    assert.equal(loadConfig({}, [...REQUIRED, "--port", "0"]).port, 0);
  });

  it("refuses a port that is not a whole number", () => {
    for (const bad of ["-1", "1.5", "http"]) {
      assert.throws(() => loadConfig({}, [...REQUIRED, "--port", bad]), ConfigError);
    }
  });

  it("turns the explorer off by flag and by environment", () => {
    assert.equal(loadConfig({}, [...REQUIRED, "--no-graphiql"]).graphiql, false);
    assert.equal(loadConfig({ NAV_SERVER_GRAPHIQL: "false" }, [...REQUIRED]).graphiql, false);
  });

  it("omits the JWKS url when it is to be discovered", () => {
    assert.equal(loadConfig({}, [...REQUIRED]).jwksUrl, undefined);
    assert.equal(
      loadConfig({}, [...REQUIRED, "--oidc-jwks-url", "https://issuer.example/keys"]).jwksUrl,
      "https://issuer.example/keys",
    );
  });

  it("reports an unknown flag rather than ignoring it", () => {
    assert.throws(() => loadConfig({}, [...REQUIRED, "--wat"]), ConfigError);
  });
});
