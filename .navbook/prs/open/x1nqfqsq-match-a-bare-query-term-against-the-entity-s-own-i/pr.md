---
title: Match a bare query term against the entity's own ID
author: Claude <noreply@anthropic.com>
created: 2026-09-23T09:25:51Z
target: dev
source: fix/sfedl5jt-search-ids
reviewer: morgan.peyre@brickcode.tech
labels: [bug, enhancement, web]
assignee: Claude <noreply@anthropic.com>
revisions:
  - head: 0804f8d3c933248016e262e06a128d4ba3533cf9
    base: 5c239803e79161559c9f233a5073b9ac505f7c79
    date: 2026-09-23T09:25:51Z
  - head: c48994e621395bdcc32e5b339eb6d778d5bb2e0f
    base: 5c239803e79161559c9f233a5073b9ac505f7c79
    date: 2026-09-26T22:29:57Z
---

Closes #sfedl5jt.

A bare query term read the title, the body and the comment bodies and nothing
else, so the identifier every mention of an entity is written with was the one
thing an entity could not be found by. Searching `ywz7` returned every issue
that had *talked about* `#ywz73dxu` and never `#ywz73dxu` itself.

## The change

One function. [`matchesText`](packages/core/src/core/query.ts) now tries the
entity's own identifier first:

```ts
function matchesIdentifier(needle: string, entity: EntityRecord): boolean {
  const wanted = needle.startsWith("#") ? needle.slice(1) : needle;
  if (wanted.length < ID_PREFIX_FLOOR) return false;
  return entity.dirName.toLowerCase().startsWith(wanted);
}
```

Three decisions worth stating, because each of them is a judgement rather than
the only option:

**A prefix of the directory name, not of the ID.** The directory name is
`<id>-<slug>` ([spec 02 §2.3](doc/spec/02-data-model.md)), so one anchored test
accepts both spellings a reader has to hand: the partial ID, and the whole
directory name copied out of a path. Matching the ID alone would have needed a
second test for the second case.

**A floor of four characters, taken from [spec 02 §2.2](doc/spec/02-data-model.md)**
rather than invented. There it is about ambiguity; here it is about noise —
it is what stops a short word search from reaching an ID it did not mean.
Ambiguity itself is deliberately *not* an error the way it is for an ID
argument: a filter matching two entities is a listing with two rows, which is
what a listing is for.

**Anchored, not a substring.** A term can only reach an entity whose ID it
names from the first character, so no ordinary word search returns anything it
did not return before.

The fix is in the shared query, so the CLI, the GraphQL API and the web
client's search box gain it together — the web client needed no code, only a
placeholder that had become wrong.

## It is also a specification change

The old behaviour was not a departure from the specification; it was the
specification. [Spec 04 §4.3](doc/spec/04-cli.md)'s bare-word row said "title,
description, or any comment body", and that row is edited here along with
`nav list --help`, the README's query section, and
[`SearchBox.vue`](packages/web/app/components/SearchBox.vue)'s placeholder,
which read "Search title, body and comments" and now names the ID.

The rest of the format was already leaning this way. §2.2's rationale for the
ID grammar is that "the mandatory digit prevents any English word (`feedback`)
from being mistaken for an ID **by searches and validators**" — the alphabet
was chosen so IDs and searches could meet safely, and that was unspent until
now.

## Verification

Against this repository's own `.navbook/`, with the branch's own core:

```console
$ node packages/cli/src/main.ts issue list "ywz7"
ID         STATUS  TITLE                                                                                    LABELS
#sfedl5jt  open    Free-text search does not match issue and PR IDs, so an ID cannot be searched for        bug,enhancement,web
#sle5dwk9  open    nav plugin and @navbook/plugin-kb are documented in five places and do not exist on dev  bug
#ywz73dxu  open    A plugin system for optional features                                                    enhancement
```

`#ywz73dxu` is found by its own ID, and `#sle5dwk9` — which only mentions it in
prose — still is too. `ywz73dxu`, `#ywz73dxu` and the full directory name all
behave the same; `ywz` reaches no ID.

Suites:

- **Five unit tests** in `packages/core/test/query.test.ts`: every spelling, the
  whole directory name, the three-character floor, the anchoring, and that an
  ID term still ANDs with the rest.
- **One end-to-end test** in `packages/web/test-e2e/issues-list.spec.ts`, which
  is what proves the web client rather than core. It uses `cafe0005`, the one
  fixture ID nothing mentions in prose, so a row that appears for it appeared
  because the ID itself matched.
- `pnpm test` (all four packages, plus conformance fixtures) and `pnpm check`
  are clean. `pnpm --filter @navbook/web test:e2e` is 152/152 against a real
  browser, OIDC flow, API and git repository, on a bundle rebuilt for this
  branch.

## Deliberately not in scope

[Spec 02 §2.2](doc/spec/02-data-model.md) makes comment IDs unique alongside
entity IDs, and a comment permalink carries one. Searching a *comment's* ID
still finds nothing; it is a separate question about what a listing of entities
should do with a match inside one, and it is not what #sfedl5jt reported.

One honest edge: §2.2's promise that a digit keeps IDs clear of English words
holds for the whole eight characters, not necessarily the first four. An ID
beginning `bugs` would be matched by a search for `bugs`. That is one extra row
in a filter rather than a wrong answer, and narrowing the rule to avoid it
would cost more than it saves.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
