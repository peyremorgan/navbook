# @navbook/plugin-kb

The Navbook knowledge base: **features** under `specs/`, the documents that
describe them, and the `feature:` key that attaches work to one.

```console
$ nav feature open "Authentication" --slug auth -m "Signing in, sessions, tokens."
Created .navbook/specs/auth/  (auth)

$ nav feature spec add auth "Login flow" -m "The app SHALL abort after 5 s."
Created .navbook/specs/auth/login-flow.md

$ nav issue open "Login times out" --feature auth -m "Aborts after 5 s on 3G."
$ nav issue list feature:auth
$ nav feature show auth
```

`nav feature show` works the membership out from the issues themselves and
reads the commits that touched them straight out of git. Nothing lists the
members on the feature's side, so two people attaching two issues touch two
different files and can never conflict.

## Installing it

```sh
nav plugin install @navbook/plugin-kb
```

And in the repository's `.navbook/navbook.json`, so every clone knows the tree
has features in it:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-kb": {}
  }
}
```

Declaring is not installing: nothing is fetched because a file names it. What
the declaration buys is that a fresh clone can say what it is missing, and that
`nav plugin install` with no argument knows what to get.

## Why it is a plugin

Not every project wants a knowledge base. Navbook's core is issues, pull
requests and the format they live in; features are a standing concept some
teams work by and others have no use for, so they ship separately and the core
stays small.

The **format** keeps them all the same. `specs/` and `feature:` are defined by
[spec 02 §2.11](../../doc/spec/02-data-model.md) and grandfathered by
[§2.12](../../doc/spec/02-data-model.md): a tree with features in it is
conforming whoever wrote it, and an implementation with features built in reads
the same files this plugin does. That is why D13 and D14 keep their numbers
rather than becoming `X-kb-*` — the conformance fixtures assert check codes,
and one suite has to validate both.

[`doc/spec.md`](doc/spec.md) is this plugin's own specification, as
[§2.12](../../doc/spec/02-data-model.md) requires of any plugin that owns data.

## Without it installed

A `nav` that does not have this plugin **preserves** `specs/` and every
`feature:` key and interprets neither. Closing an issue, merging a pull request
and running `doctor` all work and none of them loses a feature. `nav` says once
that the directory belongs to a plugin the marker does not declare, so the
silence is explained rather than merely quiet.

## What it adds

| Where | What |
|---|---|
| Format | `specs/<slug>/` and the `feature:` key; checks D13 and D14 |
| CLI | `nav feature {open,list,show,edit}`, `nav feature spec {add,edit,list}`, `--feature` on `issue open` and `pr open`, the `feature:` query term |
| API | `Feature`, `Spec`, four mutations, and `features` on every entity — merged into the server's schema |
| Commits | the `docs(feature): …` scope |
