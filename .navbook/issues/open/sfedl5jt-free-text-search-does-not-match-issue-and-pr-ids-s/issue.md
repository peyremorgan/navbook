---
title: Free-text search does not match issue and PR IDs, so an ID cannot be searched for
author: Claude <noreply@anthropic.com>
created: 2026-09-23T09:02:20Z
labels: [bug, enhancement, web]
assignee: Claude <noreply@anthropic.com>
---

Searching the web client's search box for an issue or pull request ID finds
nothing, so the one identifier every entity is guaranteed to have is the one
thing you cannot look it up by. Typing `ywz7` — a valid, unambiguous prefix of
`#ywz73dxu` — returns a listing that does not contain `#ywz73dxu`.

## Reproducing it

In the web client, open the issue listing and type `ywz7` into the search box.
`#ywz73dxu` ("A plugin system for optional features") is not in the results.

The search box is a thin front end over the same query core evaluates for the
CLI, so `nav` reproduces it without a browser. Against this repository's own
`.navbook/`:

```console
$ nav issue list "ywz7"
ID         STATUS  TITLE                                                                                    LABELS
#sle5dwk9  open    nav plugin and @navbook/plugin-kb are documented in five places and do not exist on dev  bug

$ nav issue list "ywz73dxu"
ID         STATUS  TITLE                                                                                    LABELS
#sle5dwk9  open    nav plugin and @navbook/plugin-kb are documented in five places and do not exist on dev  bug
```

Both searches find `#sle5dwk9`, whose body and one comment mention `#ywz73dxu`
in prose. Neither finds `#ywz73dxu` itself. Searching for an ID today finds
everyone who *talked about* the entity and never the entity, which is the exact
inverse of what the reader wanted.

## Where it is

One function, shared by every front end:

- [`matchesText` in `packages/core/src/core/query.ts:265-269`](packages/core/src/core/query.ts#L265-L269)
  matches a bare term against `entity.title`, `entity.body` and each
  `comment.body`, and nothing else.
- `entity.id` is already on the record it is handed
  ([`EntityRecord` in `packages/core/src/core/tree.ts:61-88`](packages/core/src/core/tree.ts#L61-L88)),
  so the data is present and unconsulted.

The web path reaches that same function with nothing of its own in between:

- [`SearchBox.vue`](packages/web/app/components/SearchBox.vue) commits the raw string;
- [`splitTerms` / `toEntityFilter` in `packages/web/app/utils/filter-params.ts`](packages/web/app/utils/filter-params.ts)
  turn it into `EntityFilter.text`;
- [`toQuery` in `packages/server/src/resolvers/map.ts:125`](packages/server/src/resolvers/map.ts#L125)
  copies it into `Query.text` verbatim;
- [`query.ts:45`](packages/server/src/resolvers/query.ts#L45) evaluates it with
  `matchesQuery`.

So this is one fix in core, and it lands in the CLI and the API at the same
time. Nothing in the web client needs to learn about IDs.

## It is a specification change, not just a defect

Worth being straight about: the code does what
[spec 04 §4.3](doc/spec/04-cli.md) currently says.

> | bare word / quoted string | Case-insensitive substring of title, description, or any comment body |

So this is a report that the specified behaviour is too narrow, and fixing it
means editing that row as well as the function. Labelled both `bug` and
`enhancement` for that reason.

The rest of the specification already leans the other way. Two rules exist that
only make sense if IDs and searches are expected to meet:

- [Spec 02 §2.2](doc/spec/02-data-model.md) gives the rationale for the ID
  grammar: "the mandatory digit prevents any English word (`feedback`) from
  being mistaken for an ID **by searches and validators**." The ID alphabet was
  chosen so that an ID can never collide with a word someone meant to search
  for. That safety was designed in and is currently unspent.
- [Spec 02 §2.2](doc/spec/02-data-model.md) also fixes what a partial ID means:
  "Wherever a CLI accepts an ID, it MUST accept any unambiguous prefix of
  length ≥ 4." `ywz7` is well-formed under a rule this project already has.

## Proposed semantics

A bare term additionally matches when, after an optional leading `#` is
stripped, it is a **prefix of the entity's ID of length ≥ 4**.

Taking the ≥ 4 rule from §2.2 rather than inventing a substring match is what
keeps the change quiet. A term shorter than four characters can never match an
ID, so no existing short search changes its results; and because a prefix is
anchored, a term can only match an ID it plausibly names. Unlike the prefix
rule for ID *arguments*, ambiguity is not an error here — a filter that matches
two entities shows two rows, which is what a listing is for.

The `#` is worth accepting because it is how every comment in this tracker
writes an ID, so it is what gets pasted into a search box.

## Acceptance

- `nav issue list ywz7`, `ywz73dxu` and `#ywz73dxu` each list `#ywz73dxu`.
- The same three in the web client's search box do the same.
- A term of three characters or fewer matches no ID.
- A term still ANDs with the other terms, and still matches title, body and
  comments as it does today — `#sle5dwk9` keeps appearing for `ywz7`.
- Spec 04 §4.3's bare-word row is updated to describe the ID match.
- [`SearchBox.vue`](packages/web/app/components/SearchBox.vue)'s placeholder
  currently reads "Search title, body and comments", which is accurate today
  and would become wrong; it needs the ID added.
