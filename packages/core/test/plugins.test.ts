/**
 * The two documents of spec 02 §2.12: a plugin's manifest, and a repository's
 * declaration of the plugins its tree uses.
 *
 * Both are read before anything is loaded, which is what these cases are
 * mostly about — a fault has to be reported against the text it was found in,
 * because at this point there is no plugin to blame it on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandPluginName,
  hasPluginKeyword,
  isPluginPackageName,
  NO_PLUGINS,
  PLUGIN_API_VERSION,
  parsePluginDeclaration,
  parsePluginPackage,
  satisfiesRange,
} from "../src/index.ts";

/** A minimal well-formed plugin package. */
const pkg = (navbook: unknown, extra: Record<string, unknown> = {}): unknown => ({
  name: "@navbook/plugin-kb",
  version: "1.0.0",
  keywords: ["navbook-plugin"],
  navbook,
  ...extra,
});

/** The manifest of a plugin, or the error that stopped it being read. */
const read = (value: unknown): string | ReturnType<typeof parsePluginPackage> => {
  const result = parsePluginPackage(value);
  return result.ok ? result : result.error;
};

describe("isPluginPackageName", () => {
  it("accepts the three spellings spec 04 §4.3 defines", () => {
    assert.ok(isPluginPackageName("@navbook/plugin-kb"));
    assert.ok(isPluginPackageName("navbook-plugin-jira"));
    assert.ok(isPluginPackageName("@acme/navbook-plugin-jira"));
  });

  it("refuses a package that merely mentions navbook", () => {
    // The guard exists so `nav plugin install` cannot be talked into
    // installing something that is not a plugin; a name that contains the
    // word is not a name that claims to be one.
    assert.equal(isPluginPackageName("navbook"), false);
    assert.equal(isPluginPackageName("navbook-cli"), false);
    assert.equal(isPluginPackageName("@navbook/core"), false);
    assert.equal(isPluginPackageName("lodash"), false);
  });

  it("refuses a prefix with nothing after it", () => {
    assert.equal(isPluginPackageName("navbook-plugin-"), false);
    assert.equal(isPluginPackageName("@navbook/plugin-"), false);
  });

  it("refuses a scope with no package", () => {
    assert.equal(isPluginPackageName("@navbook"), false);
  });

  it("does not let a foreign scope borrow the first-party spelling", () => {
    // `@acme/plugin-kb` would be a plugin of something, but not of Navbook,
    // and nothing in the name says so.
    assert.equal(isPluginPackageName("@acme/plugin-kb"), false);
  });
});

describe("expandPluginName", () => {
  it("offers the first-party name before the third-party one", () => {
    assert.deepEqual(expandPluginName("kb"), ["@navbook/plugin-kb", "navbook-plugin-kb"]);
  });

  it("leaves a name that is already a plugin's alone", () => {
    assert.deepEqual(expandPluginName("navbook-plugin-jira"), ["navbook-plugin-jira"]);
    assert.deepEqual(expandPluginName("@acme/navbook-plugin-jira"), ["@acme/navbook-plugin-jira"]);
  });

  it("leaves a scoped name alone even when it is not a plugin's", () => {
    // Expanding it would guess at a package the user did not ask for; the
    // install refuses it by name instead, which says what is wrong.
    assert.deepEqual(expandPluginName("@acme/thing"), ["@acme/thing"]);
  });
});

describe("hasPluginKeyword", () => {
  it("is true only for a package carrying the keyword", () => {
    assert.ok(hasPluginKeyword({ keywords: ["navbook-plugin", "issues"] }));
    assert.equal(hasPluginKeyword({ keywords: ["issues"] }), false);
    assert.equal(hasPluginKeyword({}), false);
    assert.equal(hasPluginKeyword({ keywords: "navbook-plugin" }), false);
    assert.equal(hasPluginKeyword(null), false);
  });
});

describe("parsePluginPackage", () => {
  it("reads a manifest", () => {
    const result = parsePluginPackage(pkg({ short: "kb" }, { engines: { navbook: "^1.0.0" } }));
    assert.ok(result.ok);
    assert.equal(result.plugin.name, "@navbook/plugin-kb");
    assert.equal(result.plugin.version, "1.0.0");
    assert.equal(result.plugin.manifest.short, "kb");
    assert.equal(result.plugin.engines, "^1.0.0");
  });

  it("reports a package with no navbook key as not a plugin", () => {
    const error = read({ name: "lodash", version: "4.0.0" });
    assert.match(error as string, /not a plugin/);
  });

  it("refuses a short name that is not one word of lowercase", () => {
    for (const short of ["KB", "k b", "kb-extra", "1kb", "", "kb!"]) {
      assert.match(read(pkg({ short })) as string, /navbook.short/, `accepted ${short}`);
    }
  });

  it("accepts digits after the first letter", () => {
    assert.ok(parsePluginPackage(pkg({ short: "k8s" })).ok);
  });

  it("requires a specification from a plugin that defines format", () => {
    // §2.12: data nobody can look up is data nobody can keep.
    const error = read(pkg({ short: "kb", format: { root: ["kb"] } }));
    assert.match(error as string, /requires 'navbook\.spec'/);
  });

  it("accepts a format declaration inside the plugin's own namespace", () => {
    const result = parsePluginPackage(
      pkg({
        short: "rep",
        spec: "doc/spec.md",
        format: { root: ["rep"], frontmatterKeys: ["rep-latest"] },
      }),
    );
    assert.ok(result.ok);
    assert.deepEqual(result.plugin.manifest.format?.root, ["rep"]);
  });

  it("refuses a directory outside the plugin's namespace", () => {
    const error = read(pkg({ short: "rep", spec: "s.md", format: { root: ["reports"] } }));
    assert.match(error as string, /'reports' is outside the 'rep' namespace/);
  });

  it("refuses a frontmatter key outside the plugin's namespace", () => {
    const error = read(
      pkg({ short: "rep", spec: "s.md", format: { frontmatterKeys: ["status"] } }),
    );
    assert.match(error as string, /'status' is outside the 'rep' namespace/);
  });

  it("lets a grandfathered plugin claim the names spec 02 §2.12 lists", () => {
    // The one plugin implementing something this format defines. The claim is
    // checkable against the specification, which is the point of requiring it
    // to be made rather than inferred.
    const result = parsePluginPackage(
      pkg({
        short: "kb",
        spec: "doc/spec.md",
        format: { root: ["specs"], frontmatterKeys: ["feature"], grandfathered: true },
      }),
    );
    assert.ok(result.ok);
    assert.equal(result.plugin.manifest.format?.grandfathered, true);
  });

  it("refuses an engines range that is not a string", () => {
    const error = read(pkg({ short: "kb" }, { engines: { navbook: 1 } }));
    assert.match(error as string, /engines\.navbook/);
  });

  it("reports no engines range rather than inventing one", () => {
    // A plugin that names none is not thereby compatible; the loader decides
    // what to do, and can only decide if it can tell the difference.
    const result = parsePluginPackage(pkg({ short: "kb" }));
    assert.ok(result.ok);
    assert.equal(result.plugin.engines, null);
  });

  it("refuses a package with no name or no version", () => {
    assert.match(read({ version: "1.0.0", navbook: { short: "kb" } }) as string, /no name/);
    assert.match(read({ name: "x", navbook: { short: "kb" } }) as string, /no version/);
  });

  it("refuses text that is not an object at all", () => {
    assert.match(read(null) as string, /not a JSON object/);
    assert.match(read([1, 2]) as string, /not a JSON object/);
  });

  it("carries the contribution blocks through untouched", () => {
    const cli = { commands: [{ name: "feature", description: "work with features" }] };
    const result = parsePluginPackage(pkg({ short: "kb", cli }));
    assert.ok(result.ok);
    assert.deepEqual(result.plugin.manifest.cli, cli);
  });
});

describe("satisfiesRange", () => {
  it("answers the ranges an engines field actually contains", () => {
    const cases: [string, string, boolean][] = [
      ["^1.0.0", "1.4.2", true],
      ["^1.0.0", "2.0.0", false],
      ["^1.2.0", "1.1.0", false],
      ["^0.3.0", "0.3.9", true],
      // Below 1.0.0 the minor is the compatibility boundary, which is the
      // whole reason a 0.x plugin pins one.
      ["^0.3.0", "0.4.0", false],
      ["^0.0.3", "0.0.4", true],
      ["~1.2.3", "1.2.9", true],
      ["~1.2.3", "1.3.0", false],
      ["~1.2", "1.2.7", true],
      ["~1", "1.9.9", true],
      [">=1.0.0", "2.5.0", true],
      [">=2.0.0", "1.9.9", false],
      [">1.0.0", "1.0.0", false],
      ["<2.0.0", "1.9.9", true],
      ["<=1.0.0", "1.0.0", true],
      ["1.x", "1.7.3", true],
      ["1.x", "2.0.0", false],
      ["1.2.x", "1.2.5", true],
      ["1.2.x", "1.3.0", false],
      ["1.0.0", "1.0.0", true],
      ["1.0.0", "1.0.1", false],
      ["*", "9.9.9", true],
      ["^1.0.0 || ^2.0.0", "2.1.0", true],
      ["^1.0.0 || ^2.0.0", "3.0.0", false],
    ];
    for (const [range, version, expected] of cases) {
      assert.equal(satisfiesRange(range, version), expected, `${version} against ${range}`);
    }
  });

  it("refuses a range it cannot read rather than guessing", () => {
    // A range nobody can parse is not evidence that a plugin is compatible.
    for (const range of ["latest", ">=1.0.0 <2", "1.0.0-beta || nonsense", "~>1.2"]) {
      assert.equal(satisfiesRange(range, "1.5.0"), false, `accepted ${range}`);
    }
  });

  it("refuses a version it cannot read", () => {
    assert.equal(satisfiesRange("^1.0.0", "next"), false);
  });

  it("accepts the version this implementation provides against a plugin's caret", () => {
    // The case every plugin in the wild will actually exercise.
    assert.ok(satisfiesRange("^1.0.0", PLUGIN_API_VERSION));
  });
});

describe("parsePluginDeclaration", () => {
  it("reads the packages a marker declares, with their settings", () => {
    const reading = parsePluginDeclaration(
      JSON.stringify({ version: 1, plugins: { "@navbook/plugin-kb": { depth: 2 } } }),
    );
    assert.ok(reading.declared);
    assert.deepEqual(reading.problems, []);
    assert.deepEqual([...reading.plugins.keys()], ["@navbook/plugin-kb"]);
    assert.deepEqual(reading.plugins.get("@navbook/plugin-kb"), { depth: 2 });
  });

  it("declares nothing for a marker without the key", () => {
    const reading = parsePluginDeclaration(JSON.stringify({ version: 1 }));
    assert.equal(reading.declared, false);
    assert.equal(reading.plugins.size, 0);
    assert.deepEqual(reading.problems, []);
  });

  it("declares nothing for a repository with no marker", () => {
    assert.deepEqual(parsePluginDeclaration(undefined), NO_PLUGINS);
  });

  it("reports text that is not JSON, and still declares nothing", () => {
    const reading = parsePluginDeclaration("{oh dear");
    assert.deepEqual(reading.problems, ["is not valid JSON"]);
    assert.equal(reading.declared, false);
  });

  it("reports a marker that is not an object", () => {
    assert.deepEqual(parsePluginDeclaration("[1,2]").problems, ["is not a JSON object"]);
  });

  it("reports a plugins key that is not an object", () => {
    const reading = parsePluginDeclaration(JSON.stringify({ plugins: ["@navbook/plugin-kb"] }));
    assert.deepEqual(reading.problems, ["'plugins' must be an object"]);
    assert.equal(reading.plugins.size, 0);
  });

  it("drops one malformed entry and keeps the rest", () => {
    // One mistyped plugin should not take the others with it, the way one
    // mistyped policy key does not take the other (§2.10).
    const reading = parsePluginDeclaration(
      JSON.stringify({ plugins: { "@navbook/plugin-kb": {}, "navbook-plugin-x": true } }),
    );
    assert.deepEqual(reading.problems, [
      "'plugins.navbook-plugin-x' must be an object of settings",
    ]);
    assert.deepEqual([...reading.plugins.keys()], ["@navbook/plugin-kb"]);
    assert.ok(reading.declared);
  });

  it("reads an empty declaration as declaring nothing but being present", () => {
    const reading = parsePluginDeclaration(JSON.stringify({ plugins: {} }));
    assert.ok(reading.declared);
    assert.equal(reading.plugins.size, 0);
  });
});
