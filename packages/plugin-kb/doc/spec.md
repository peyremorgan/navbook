# The knowledge base

**Normative.** This document defines the data `@navbook/plugin-kb` keeps in a
Navbook tree, in the sense the [Navbook specification](../../../doc/spec/README.md)
defines the rest of it. A plugin that owns data must publish one
([02 §2.12](../../../doc/spec/02-data-model.md)), because a tree is meant to
outlive the tool that wrote it and data nobody can look up is data nobody can
keep.

It is a short document, and deliberately so: what it describes is already in
the Navbook specification at [02 §2.11](../../../doc/spec/02-data-model.md).
Features and their documents were part of the format before they were a plugin,
and they remain part of it — `specs/` and `feature:` are **grandfathered**
names ([02 §2.12](../../../doc/spec/02-data-model.md)), not names this plugin
claimed. So this document says what the plugin adds, and points at the
specification for what the files are.

## The data

| What | Where | Defined by |
|---|---|---|
| Features and their documents | `specs/<slug>/` | [02 §2.11](../../../doc/spec/02-data-model.md) |
| An entity's membership | `feature:` in `issue.md` / `pr.md` | [02 §2.11](../../../doc/spec/02-data-model.md) |

Nothing here is a second definition of either. A tree written by a `nav` with
this plugin installed and one written by an implementation with features built
in are the same tree, which is what the conformance fixtures check.

## What the plugin contributes

**Commands** — `nav feature {open,list,show,edit}` and
`nav feature spec {add,edit,list}`, as [04 §4.3](../../../doc/spec/04-cli.md)
describes them.

**On the built-in verbs** — `--feature <slug>` on `nav issue open` and
`nav pr open`, and the `feature:` query term on both listings.

**Checks** — D13 and D14. They keep their numbers rather than becoming
`X-kb-1` and `X-kb-2`, which is the one place this plugin is treated specially
and is worth stating plainly:

- The Navbook specification defines what they check, because it still defines
  features. A check number in the `D` series names something that document
  says, and these two do.
- The conformance fixtures assert check codes. An implementation providing
  features natively and one providing them through this plugin therefore report
  the same diagnostics, and a single fixture suite validates both. The planned
  Rust CLI ([05 §5.3](../../../doc/spec/05-implementation.md)) will have
  features long before it has plugins, and this is what lets it pass.

A plugin that is *not* grandfathered numbers its checks `X-<short>-<n>` and
must.

**Commit scope** — `docs(feature): …`, as
[03 §3.2](../../../doc/spec/03-merge-and-branches.md) describes.

**API** — `Feature`, `Spec`, the four mutations, and `features` on every
entity, merged into the server's schema. See `schema.graphql` beside this file.

## Settings

None. The `plugins` entry for this package is an empty object:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-kb": {}
  }
}
```

## What a tree looks like without it

A `nav` that does not have this plugin **preserves** `specs/` and the
`feature:` key and interprets neither, which is what
[02 §2.12](../../../doc/spec/02-data-model.md) requires of any tool meeting a
namespace it does not know. Closing an issue, merging a pull request and
running `doctor` all work, and none of them loses a feature. `nav` says once
that the directory belongs to a plugin the marker does not declare, so the
silence is explained rather than merely quiet.
