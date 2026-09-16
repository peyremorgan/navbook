/**
 * Reading the configuration, from flags and from the environment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../../src/config.ts";

const DISCOVERY = "https://issuer.example/.well-known/openid-configuration";
const REQUIRED = ["--oidc-discovery-url", DISCOVERY, "--oidc-audience", "navbook"] as const;

describe("loadConfig", () => {
  it("reads the required options from flags", () => {
    const config = loadConfig({}, [...REQUIRED]);
    assert.deepEqual(config.provider, { discoveryUrl: DISCOVERY });
    assert.equal(config.audience, "navbook");
  });

  it("reads them from the environment when no flag is given", () => {
    const config = loadConfig(
      {
        NAV_SERVER_OIDC_DISCOVERY_URL: "https://from-env.example/oidc",
        NAV_SERVER_OIDC_AUDIENCE: "env-audience",
      },
      [],
    );
    assert.deepEqual(config.provider, { discoveryUrl: "https://from-env.example/oidc" });
    assert.equal(config.audience, "env-audience");
  });

  it("prefers a flag over the environment", () => {
    const config = loadConfig({ NAV_SERVER_OIDC_DISCOVERY_URL: "https://ignored.example" }, [
      ...REQUIRED,
    ]);
    assert.deepEqual(config.provider, { discoveryUrl: DISCOVERY });
  });

  it("says which required option is missing", () => {
    assert.throws(
      () => loadConfig({}, []),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /--oidc-discovery-url/);
        return true;
      },
    );
  });

  it("takes the issuer and its keys spelled out instead of a discovery document", () => {
    const config = loadConfig({}, [
      "--oidc-issuer",
      "https://issuer.example",
      "--oidc-jwks-url",
      "https://issuer.example/keys",
      "--oidc-audience",
      "navbook",
    ]);
    assert.deepEqual(config.provider, {
      issuer: "https://issuer.example",
      jwksUrl: "https://issuer.example/keys",
    });
  });

  it("refuses half of the spelled-out shape, naming the other half", () => {
    for (const half of [
      ["--oidc-issuer", "https://issuer.example"],
      ["--oidc-jwks-url", "https://issuer.example/keys"],
    ]) {
      assert.throws(
        () => loadConfig({}, [...half, "--oidc-audience", "navbook"]),
        /--oidc-issuer and --oidc-jwks-url go together/,
      );
    }
  });

  it("refuses both shapes at once, rather than guessing which one is meant", () => {
    assert.throws(
      () => loadConfig({ NAV_SERVER_OIDC_ISSUER: "https://issuer.example" }, [...REQUIRED]),
      /give one or the other/,
    );
    // An empty variable, which is how a container leaves a setting unset, is
    // not a second shape.
    assert.deepEqual(
      loadConfig({ NAV_SERVER_OIDC_ISSUER: "", NAV_SERVER_OIDC_JWKS_URL: "" }, [...REQUIRED])
        .provider,
      { discoveryUrl: DISCOVERY },
    );
  });

  it("defaults the port, remote, staleness window, git timeout and explorer", () => {
    const config = loadConfig({}, [...REQUIRED]);
    assert.equal(config.port, 4000);
    assert.equal(config.remote, "origin");
    assert.equal(config.pullIntervalMs, 10_000);
    assert.equal(config.gitTimeoutMs, 30_000);
    assert.equal(config.graphiql, true);
  });

  it("reads the git timeout from a flag or the environment, 0 meaning none", () => {
    assert.equal(loadConfig({}, [...REQUIRED, "--git-timeout-ms", "5000"]).gitTimeoutMs, 5000);
    assert.equal(loadConfig({ NAV_SERVER_GIT_TIMEOUT_MS: "0" }, [...REQUIRED]).gitTimeoutMs, 0);
    assert.throws(() => loadConfig({}, [...REQUIRED, "--git-timeout-ms", "soon"]), ConfigError);
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

  it("reports an unknown flag rather than ignoring it", () => {
    assert.throws(() => loadConfig({}, [...REQUIRED, "--wat"]), ConfigError);
  });

  describe("the authorization policy", () => {
    it("is open when nothing is given", () => {
      assert.deepEqual(loadConfig({}, [...REQUIRED]).policy, {
        requireClaims: [],
        allowEmailDomains: [],
        requireEmailVerified: false,
      });
    });

    it("reads repeated claim flags, each as name=value", () => {
      const { policy } = loadConfig({}, [
        ...REQUIRED,
        "--require-claim",
        "roles=d3952bfb::developer",
        "--require-claim",
        "scope=navbook",
      ]);
      assert.deepEqual(policy.requireClaims, [
        { name: "roles", value: "d3952bfb::developer" },
        { name: "scope", value: "navbook" },
      ]);
    });

    it("reads the claims from a comma-separated variable", () => {
      const { policy } = loadConfig(
        { NAV_SERVER_REQUIRE_CLAIMS: "roles=navbook::member, scope=navbook,," },
        [...REQUIRED],
      );
      assert.deepEqual(policy.requireClaims, [
        { name: "roles", value: "navbook::member" },
        { name: "scope", value: "navbook" },
      ]);
    });

    it("lets a flag replace the variable's list rather than join it", () => {
      const { policy } = loadConfig({ NAV_SERVER_REQUIRE_CLAIMS: "roles=ignored" }, [
        ...REQUIRED,
        "--require-claim",
        "roles=member",
      ]);
      assert.deepEqual(policy.requireClaims, [{ name: "roles", value: "member" }]);
    });

    it("refuses a claim requirement that is not name=value", () => {
      for (const bad of ["roles", "=x", "roles="]) {
        assert.throws(
          () => loadConfig({}, [...REQUIRED, "--require-claim", bad]),
          /--require-claim takes <name>=<value>/,
        );
      }
      assert.throws(
        () => loadConfig({ NAV_SERVER_REQUIRE_CLAIMS: "roles" }, [...REQUIRED]),
        ConfigError,
      );
    });

    it("reads the email domains, normalised, from flags or the variable", () => {
      assert.deepEqual(
        loadConfig({}, [...REQUIRED, "--allow-email-domain", "@Example.com"]).policy
          .allowEmailDomains,
        ["example.com"],
      );
      assert.deepEqual(
        loadConfig({ NAV_SERVER_ALLOW_EMAIL_DOMAINS: "a.test, B.test" }, [...REQUIRED]).policy
          .allowEmailDomains,
        ["a.test", "b.test"],
      );
    });

    it("refuses an address where a domain was wanted", () => {
      assert.throws(
        () => loadConfig({}, [...REQUIRED, "--allow-email-domain", "me@example.com"]),
        /--allow-email-domain takes a domain/,
      );
    });

    it("requires a verified email by flag or by variable, and only by 'true'", () => {
      assert.equal(
        loadConfig({}, [...REQUIRED, "--require-email-verified"]).policy.requireEmailVerified,
        true,
      );
      assert.equal(
        loadConfig({ NAV_SERVER_REQUIRE_EMAIL_VERIFIED: "true" }, [...REQUIRED]).policy
          .requireEmailVerified,
        true,
      );
      for (const off of ["false", ""]) {
        assert.equal(
          loadConfig({ NAV_SERVER_REQUIRE_EMAIL_VERIFIED: off }, [...REQUIRED]).policy
            .requireEmailVerified,
          false,
        );
      }
      assert.throws(
        () => loadConfig({ NAV_SERVER_REQUIRE_EMAIL_VERIFIED: "yes" }, [...REQUIRED]),
        /NAV_SERVER_REQUIRE_EMAIL_VERIFIED takes true or false/,
      );
    });
  });
});
