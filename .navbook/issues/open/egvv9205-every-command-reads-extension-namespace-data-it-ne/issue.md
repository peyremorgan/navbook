---
title: Every command reads extension-namespace data it never interprets
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:38:34Z
labels: [performance, enhancement]
feature: [format, plugins]
---

`readNavTree` walks the whole Navbook directory and reads every file it finds. The only thing it declines to open is a `comments/` directory that is out of scope:

```ts
if (entry.isDirectory()) {
  if (entry.name === "comments" && !wanted(rel, comments)) continue;
  walk(childAbs, childRel, files, comments);
} else if (entry.isFile()) {
  files.set(childRel, readFileSync(childAbs, "utf8"));
}
```

Everything else is read in full — including a top-level **extension namespace** under spec 02 §2.12, and a `<short>/` or `<short>.*` file inside an entity directory. `parseTree` then records the path and throws the content away:

```ts
if (root !== ENTITY_DIR.issue && root !== ENTITY_DIR.pr) {
  // Reserved and unknown names are tolerated and preserved untouched (§2.10).
  if (path !== NAV_MARKER) reserved.push(path);
  return;
}
```

`Repo.reserved` is a list of strings. The bytes were read for nothing.

## Measured

A repository with one issue and one uninterpreted 24 MB file under `.navbook/reports/`, read the way `nav issue list` reads it:

```
paths read: 8
includes the extension file: true
total characters held in memory: 25,089,006
readNavTree took: 5.0 ms
RSS after: 158 MB
```

Eight paths, of which one is the extension file, and 25 million characters held for the life of the command to answer a question about one issue. The 5 ms is a warm page cache on an SSD; what does not go away is the UTF-8 decode and the resident memory, both linear in whatever a plugin writes.

## Why it matters now

§2.12 *invites* this data — `.navbook/reports/` is its own worked example for the top-level namespace, and `.navbook/prs/open/dk3mp2x9-auth/reports.json` for the per-entity one. A test-report plugin, the motivating example in `doc/plugins.md`, writes a document per pull request. All of it would then be read by every `nav issue list`, `nav issue show`, `nav doctor` and every GraphQL request that loads the tree, whether or not the plugin is installed.

Spec 05 §5.2 sets the budget this eats into: "cold `nav issue list` on a 1 000-issue repo MUST complete in under 500 ms". `loadRepoForQuery` already goes to some trouble to avoid reading comment files it does not need — `CommentScope` exists for exactly that. Extension data gets no such treatment.

## The second half: binary data

Spec 02 §2.11 already permits non-text inside a feature directory: "Anything else it holds — subdirectories, **images**, loose text — MUST be preserved untouched and MUST NOT be interpreted." `readFileSync(path, "utf8")` on a PNG produces a string full of U+FFFD. Nothing writes those strings back today, so this is a latent hazard rather than a live corruption — worth closing before something reads `Repo.reserved` and decides to copy a file.

## What it should do

Keep the walk, skip the read. The path must stay in the map, since that is what `reserved` is built from and what makes "preserve what you do not understand" checkable; only the content needs to go:

```ts
/** Paths whose content nothing interprets: read their names, not their bytes. */
function interpreted(rel: string): boolean {
  const [root] = rel.split("/");
  return root === ENTITY_DIR.issue || root === ENTITY_DIR.pr
    || root === SPECS_DIR || rel === NAV_MARKER || root === "archive";
}
```

A tidier version has `classify` say which paths it will parse and lets the walk ask, which puts the decision where the knowledge is — a larger change that inverts the current direction of the dependency. Either way the same reasoning applies one level down, to an entity directory's `extraFiles`.
