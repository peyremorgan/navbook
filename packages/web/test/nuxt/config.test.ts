/**
 * The runtime configuration is the first thing to fail on a bad deployment, so
 * it is the first thing that has to fail clearly.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfigError, loadConfig, parseConfig } from "../../app/utils/config";

const VALID = {
  graphqlUrl: "https://nav.example.invalid/graphql",
  oidc: { issuer: "https://id.example.invalid", clientId: "navbook-web", audience: "navbook" },
};

describe("parseConfig", () => {
  it("accepts a complete document and trims it", () => {
    const config = parseConfig({
      graphqlUrl: "  https://nav.example.invalid/graphql  ",
      oidc: { issuer: "https://id.example.invalid ", clientId: "navbook-web", audience: "navbook" },
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

describe("loadConfig", () => {
  it("fetches, parses and validates", async () => {
    const config = await loadConfig(async () => Response.json(VALID));
    assert.deepEqual(config, VALID);
  });

  it("says so when the file is not there", async () => {
    await assert.rejects(
      loadConfig(async () => new Response("nope", { status: 404 })),
      /could not fetch config.json: HTTP 404/,
    );
  });

  it("says so when the file is not JSON", async () => {
    await assert.rejects(
      loadConfig(async () => new Response("<!doctype html>", { status: 200 })),
      /config.json is not valid JSON/,
    );
  });

  it("says so when the fetch itself fails", async () => {
    await assert.rejects(
      loadConfig(async () => {
        throw new TypeError("network down");
      }),
      /could not fetch config.json: network down/,
    );
  });
});
