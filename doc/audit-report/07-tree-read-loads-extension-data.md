# 07 — Every command reads extension-namespace data it never interprets

**Tracked as:** `#egvv9205` — `nav issue show egvv9205`
**Severity:** Low–Medium — no fault today, a growing one as spec 02 §2.12 is
taken up, and it decodes arbitrary bytes as UTF-8.
**Where:** [`packages/core/src/workspace/workspace.ts:59-94`](../../packages/core/src/workspace/workspace.ts#L59-L94)

## What is wrong

`readNavTree` walks the whole Navbook directory and reads every file it finds:

```ts
// packages/core/src/workspace/workspace.ts:66-88
function walk(absolute, rel, files, comments): void {
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "comments" && !wanted(rel, comments)) continue;
      walk(childAbs, childRel, files, comments);
    } else if (entry.isFile()) {
      files.set(childRel, readFileSync(childAbs, "utf8"));
    }
  }
}
```

The only thing it declines to open is a `comments/` directory that is out of
scope. Everything else — including a top-level directory that is an **extension
namespace** under §2.12, and a `<short>/` or `<short>.*` file inside an entity
directory — is read into memory in full.

`parseTree` then records those paths and throws the content away:

```ts
// packages/core/src/core/tree.ts:273-279
if (root !== ENTITY_DIR.issue && root !== ENTITY_DIR.pr) {
  // Reserved and unknown names are tolerated and preserved untouched (§2.10).
  if (path !== NAV_MARKER) reserved.push(path);
  return;
}
```

`Repo.reserved` is a list of strings. The bytes were read for nothing.

## Why it matters now

Spec 02 §2.12 — added to this branch in commit `780c315` — *invites* exactly
this data:

> | Namespace | Shape | Example |
> | A top-level directory | `<short>/` at the top of the root directory | `.navbook/reports/` |
> | Inside an entity directory | `<short>/` or `<short>.*` beside `issue.md` or `pr.md` | `.navbook/prs/open/dk3mp2x9-auth/reports.json` |

A test-report plugin, the motivating example in `doc/plugins.md`, puts a JSON
document per pull request in the second namespace. Everything a plugin writes is
now read by every `nav issue list`, `nav issue show`, `nav doctor` and every
GraphQL request that loads the tree, whether or not the plugin is installed.

Spec 05 §5.2 sets the budget this eats into:

> cold `nav issue list` on a 1 000-issue repo MUST complete in under 500 ms on
> commodity hardware. (Measured floor: ~40 ms Node startup + ~110 ms with one
> heavy import — import cost is the budget's main enemy …)

`loadRepoForQuery` already goes to some trouble to *avoid* reading comment files
it does not need (`workspace.ts:111-114`, and `CommentScope` exists for exactly
this). Extension data gets no such treatment.

## Reproduction

A repository with one issue and one uninterpreted 24 MB extension file:

```console
$ mkdir -p .navbook/reports
$ node -e 'require("fs").writeFileSync(".navbook/reports/coverage.json", …)'   # 24M
$ nav doctor | tail -1
No problems found.
```

Reading the tree the way `nav issue list` reads it:

```
paths read: 8
includes the extension file: true
total characters held in memory: 25,089,006
readNavTree took: 5.0 ms
RSS after: 158 MB
```

Eight paths, of which one is the extension file; 25 million characters held for
the life of the command to answer a question about one issue. The 5 ms is a warm
page cache on an SSD — the cost that does not go away is the UTF-8 decode and
the resident memory, both linear in whatever a plugin writes.

## The second half: binary data

§2.11 already permits non-text inside a feature directory:

> Anything else it holds — subdirectories, **images**, loose text — MUST be
> preserved untouched and MUST NOT be interpreted.

`readFileSync(path, "utf8")` on a PNG produces a string full of U+FFFD. Nothing
writes those strings back today — `applyOps` only ever writes content a planner
produced, and `extraFiles` carries paths rather than contents — so this is a
latent hazard rather than a live corruption. It is worth closing before
something does read `Repo.reserved` and decide to copy a file.

## Suggested fix

The cheapest change keeps the walk and skips the read:

```ts
/** Paths whose content nothing interprets: read their names, not their bytes. */
function interpreted(rel: string): boolean {
  const [root] = rel.split("/");
  return root === ENTITY_DIR.issue || root === ENTITY_DIR.pr
    || root === SPECS_DIR || rel === NAV_MARKER || root === "archive";
}
```

and, in `walk`, `files.set(childRel, interpreted(childRel) ? readFileSync(...) : "")`.
That keeps the path in the map — which is what `reserved` is built from and what
makes "preserve what you do not understand" checkable — while reading nothing.

A tidier version puts the decision where the knowledge is: have `classify` say
which paths it will parse, and let the walk ask. That is a larger change and
inverts the current direction of the dependency, so it is a judgement call.

Either way the same reasoning applies one level down: an entity directory's
`extraFiles` (`tree.ts:346`) are read and discarded, and those are the §2.12
per-entity namespace.

## Note on `parseTree`

`parseTree` takes a flat `path → content` map by design, so that it works "over
a working tree, a git index, or the blobs of a branch that is not checked out"
(`tree.ts:4-6`). That is a good interface and this finding does not argue with
it — the caller is what should decide not to fill in content nobody reads. The
`refscan` caller already does something similar: it reads only what is under a
pull request's own directory.
