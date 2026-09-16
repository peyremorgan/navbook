/**
 * The runtime configuration is the first thing to fail on a bad deployment, so
 * it is the first thing that has to fail clearly.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfigError, configUrl, loadConfig, parseConfig } from "../../app/utils/config";

const VALID = {
  graphqlUrl: "https://nav.example.invalid/graphql",
  oidc: {
    discoveryUrl: "https://id.example.invalid/.well-known/openid-configuration",
    clientId: "navbook-web",
    audience: "navbook",
  },
};

describe("parseConfig", () => {
  it("accepts a complete document and trims it", () => {
    const config = parseConfig({
      graphqlUrl: "  https://nav.example.invalid/graphql  ",
      oidc: {
        discoveryUrl: "https://id.example.invalid/.well-known/openid-configuration ",
        clientId: "navbook-web",
        audience: "navbook",
      },
    });
    assert.deepEqual(config, VALID);
  });

  it("names the missing key", () => {
    assert.throws(() => parseConfig({ ...VALID, graphqlUrl: undefined }), {
      name: "Error",
      message: /graphqlUrl must be a non-empty string/,
    });
    assert.throws(() => parseConfig({ ...VALID, oidc: { ...VALID.oidc, audience: "" } }), {
      message: /oidc.audience must be a non-empty string/,
    });
  });

  it("refuses a document that is not an object", () => {
    for (const input of [null, "text", 42, [], undefined]) {
      assert.throws(() => parseConfig(input), ConfigError);
    }
  });

  it("refuses an oidc section that is not an object", () => {
    assert.throws(() => parseConfig({ ...VALID, oidc: [] }), /oidc must be an object/);
    assert.throws(() => parseConfig({ graphqlUrl: VALID.graphqlUrl }), /oidc must be an object/);
  });

  it("ignores keys it does not know", () => {
    const config = parseConfig({ ...VALID, spare: true });
    assert.deepEqual(config, VALID);
  });
});

describe("configUrl", () => {
  it("is absolute, so a deep reload asks for the same file as the front page", () => {
    assert.equal(configUrl(), "/config.json");
    assert.equal(configUrl("/"), "/config.json");
  });

  it("honours a base the app is mounted under, with or without its slash", () => {
    assert.equal(configUrl("/navbook/"), "/navbook/config.json");
    assert.equal(configUrl("/navbook"), "/navbook/config.json");
  });
});

describe("loadConfig", () => {
  it("fetches, parses and validates", async () => {
    const config = await loadConfig({ fetch: async () => Response.json(VALID) });
    assert.deepEqual(config, VALID);
  });

  it("asks for the url it was given", async () => {
    let asked = "";
    await loadConfig({
      url: "/navbook/config.json",
      fetch: async (input) => {
        asked = String(input);
        return Response.json(VALID);
      },
    });
    assert.equal(asked, "/navbook/config.json");
  });

  it("says so when the file is not there", async () => {
    await assert.rejects(
      loadConfig({ fetch: async () => new Response("nope", { status: 404 }) }),
      /could not fetch \/config.json: HTTP 404/,
    );
  });

  it("says so when the file is not JSON", async () => {
    // The failure that matters: an SPA host answering an unknown path with the
    // index page, which is what a route-relative fetch used to provoke.
    await assert.rejects(
      loadConfig({ fetch: async () => new Response("<!doctype html>", { status: 200 }) }),
      /\/config.json is not valid JSON/,
    );
  });

  it("says so when the fetch itself fails", async () => {
    await assert.rejects(
      loadConfig({
        fetch: async () => {
          throw new TypeError("network down");
        },
      }),
      /could not fetch \/config.json: network down/,
    );
  });
});
