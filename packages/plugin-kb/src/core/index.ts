/**
 * The knowledge base's format half — spec 02 §2.11, §2.12.
 *
 * Everything registered here used to be built into `@navbook/core`: the
 * `specs/` directory, the `feature:` key, the `feature:` query term, and the
 * two checks over them. Same behaviour, reached through registrations rather
 * than through code core carried itself.
 *
 * `specs/` and `feature:` keep their names, and D13 and D14 keep their numbers.
 * §2.12 grandfathers the names because this format still defines them; the
 * check numbers follow for the same reason, and for one more — they are what
 * the conformance fixtures assert, so an implementation with features built in
 * and one with them in a plugin report the same diagnostics, and a single
 * fixture suite validates both. That matters for the planned Rust CLI, which
 * will have features long before it has plugins.
 */

import type { CorePluginHost, EntityRecord, Repo } from "@navbook/core";
import {
  checkFeatureKey,
  readFeatures,
  SPECS_DIR,
  useCore,
  validateFeature,
  validateSpec,
} from "./files.ts";
import { buildKb, kbOf } from "./tree.ts";

/** A diagnostic in the shape a registered check returns. */
type Found = { check: string; level: "error" | "warning"; path: string; message: string };

export function activate(host: CorePluginHost): void {
  const { core } = host;
  // Before anything else: the format helpers take the running core from here
  // rather than importing one of their own (see `files.ts`).
  useCore(core);

  host.register({
    treeLocations: [
      {
        dir: SPECS_DIR,
        build: (files, paths) => buildKb(files, paths, (text) => core.parseFile(text)),
      },
    ],

    frontmatterKeys: [
      {
        key: "feature",
        kinds: ["issue", "pr"],
        // Scalar or list, as `assignee` is (§2.5): one feature SHOULD be
        // written as a scalar, which is what nearly every entity carries.
        shape: "string-or-list",
        validate: (value) => checkFeatureKey(value),
      },
    ],

    queryKeys: [
      {
        key: "feature",
        kinds: ["issue", "pr"],
        // Repeating the term ANDs, as it does for `label` and `assignee`: a
        // multi-valued key asks for an entity carrying all of them.
        matches: (values, entity: EntityRecord) => {
          const features = readFeatures(entity.fm).map((slug) => slug.toLowerCase());
          return values.every((wanted) => features.includes(wanted.toLowerCase()));
        },
      },
    ],

    doctorChecks: [
      { id: "D13", level: "error", run: (repo) => [...layoutFaults(repo), ...schemaFaults(repo)] },
      { id: "D14", level: "warning", run: (repo) => danglingFeatures(repo) },
    ],

    commitScopes: ["feature"],
  });
}

/** D13's first half: what could not be read as a feature at all. */
function layoutFaults(repo: Repo): Found[] {
  return (repo.extProblems.get(SPECS_DIR) ?? []).map((problem) => ({
    check: "D13",
    level: "error" as const,
    path: problem.path,
    message: problem.message,
  }));
}

/** D13's second half: a `feature.md` or document missing a required key. */
function schemaFaults(repo: Repo): Found[] {
  const out: Found[] = [];
  for (const feature of kbOf(repo.ext).features) {
    for (const problem of validateFeature(feature.parsed)) {
      out.push({ check: "D13", level: "error", path: feature.filePath, message: problem.message });
    }
    for (const spec of feature.specs) {
      for (const problem of validateSpec(spec.parsed)) {
        out.push({ check: "D13", level: "error", path: spec.path, message: problem.message });
      }
    }
  }
  return out;
}

/**
 * D14: a `feature:` naming a slug no directory in this tree holds.
 *
 * A warning, for the reason a dangling `#id` is (§2.9): the feature may have
 * been created on a branch nobody has fetched, and an error would make the
 * order in which two branches land a correctness question.
 */
function danglingFeatures(repo: Repo): Found[] {
  const known = kbOf(repo.ext).featureBySlug;
  const out: Found[] = [];
  for (const entity of [...repo.issues, ...repo.prs]) {
    for (const slug of readFeatures(entity.fm)) {
      if (known.has(slug)) continue;
      out.push({
        check: "D14",
        level: "warning",
        path: entity.filePath,
        message: `feature '${slug}' does not exist in this tree`,
      });
    }
  }
  return out;
}

export * from "./files.ts";
export * from "./ops.ts";
export * from "./tree.ts";
