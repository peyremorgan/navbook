/**
 * The canonical JSON projection of a feature and its documents — spec 04 §4.2.
 *
 * Shaped so a reader of `nav feature list --json` and a reader of the API are
 * looking at the same thing, which is the rule the format's own projection
 * follows and which an extension has no reason to break.
 */

import type { FeatureRecord, SpecRecord } from "./tree.ts";

/** A feature as `--json` emits it, with the members it was asked to carry. */
export function featureJson(
  navDir: string,
  feature: FeatureRecord,
  members: { issues: string[]; prs: string[] },
): Record<string, unknown> {
  return {
    // Identity first, then the frontmatter as the file spells it, then the
    // derived parts — the order every other `--json` projection uses, and the
    // one the conformance fixtures compare byte for byte (spec 04 §4.2).
    slug: feature.slug,
    path: `${navDir}/${feature.dirPath}`,
    ...feature.fm,
    body: feature.body.trim(),
    specs: feature.specs.map((spec) => ({ file: spec.fileName, title: spec.title })),
    issues: members.issues,
    prs: members.prs,
  };
}

/** One specification document as `--json` emits it. */
export function specJson(
  navDir: string,
  feature: FeatureRecord,
  spec: SpecRecord,
): Record<string, unknown> {
  return {
    feature: feature.slug,
    file: spec.fileName,
    path: `${navDir}/${spec.path}`,
    ...spec.fm,
    body: spec.body.trim(),
  };
}
