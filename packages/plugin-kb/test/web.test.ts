/**
 * What the layer reads off an entity the host fetched.
 *
 * `Entity.ext` is a `JSON` scalar (spec 06 §6.3), so what arrives is whatever
 * the server put there and the schema promises nothing about its shape. That
 * makes this reader the boundary between a typed client and an untyped field,
 * and the cases worth proving are all absences: a server without this plugin
 * loaded, a server with an older one, and a value of the wrong type. Each has
 * to read as "no features" rather than as a page that will not render — the
 * chips are decoration on somebody else's row, and a plugin version mismatch
 * must not be the reason the issue list is blank.
 *
 * Tested here rather than in the app because it is a pure function: the rest
 * of the layer is components, which the host's own type check compiles.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readKbFeatures } from "../web/app/utils/features.ts";

describe("readKbFeatures", () => {
  it("reads the slugs this plugin's server half wrote", () => {
    assert.deepEqual(readKbFeatures({ kb: { features: ["auth", "billing"] } }), [
      "auth",
      "billing",
    ]);
  });

  it("is empty when this plugin's server half is not loaded", () => {
    // The client was built with the layer and the API without the plugin: a
    // mismatched deployment, and one that must still show the issue list.
    assert.deepEqual(readKbFeatures({}), []);
    assert.deepEqual(readKbFeatures({ other: { features: ["auth"] } }), []);
  });

  it("is empty when there is no ext at all", () => {
    assert.deepEqual(readKbFeatures(null), []);
    assert.deepEqual(readKbFeatures(undefined), []);
  });

  it("is empty for a key of the wrong shape, rather than throwing", () => {
    assert.deepEqual(readKbFeatures({ kb: null }), []);
    assert.deepEqual(readKbFeatures({ kb: "auth" }), []);
    assert.deepEqual(readKbFeatures({ kb: {} }), []);
    assert.deepEqual(readKbFeatures({ kb: { features: "auth" } }), []);
  });

  it("keeps only the strings out of a list that holds other things", () => {
    assert.deepEqual(readKbFeatures({ kb: { features: ["auth", 3, null, "billing"] } }), [
      "auth",
      "billing",
    ]);
  });
});
