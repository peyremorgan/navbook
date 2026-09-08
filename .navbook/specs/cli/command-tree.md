---
title: Command tree
---

## What exists

Everything is noun-verb (spec 04 §4.3). `issue` and `pr` share `open list show edit comment close reopen delete`; `issue` adds `link` and `unlink`; `pr` adds `update request review merge`; `feature` has `open list show edit` and the `spec add edit list` group. Root utilities are `init`, `id`, `doctor`, `install` and `uninstall`.

- **IDs** accept any unambiguous prefix of four characters or more, and a whole `<id>-<slug>` directory name.
- **`--commit`** on any mutating verb wraps the change in a `docs(<scope>):` commit, and refuses to run with unrelated changes already staged. A no-op lands as "Nothing to commit" rather than a git error.
- **`--json`** on every listing and `show`: one object per entity, identity keys first, frontmatter in file order, then the body. `list` and `show` never change a key's type. `pr show` adds two keys that are not frontmatter — `review`, because it has already read the comments that state is derived from, and `reviewPolicy`, the marker's policy it was counted against (spec 02 §2.10).
- **Query grammar** — `status:`, `label:`, `assignee:`, `author:`, `milestone:`, `feature:` and bare words, plus `reviewer:`, `review:` and `awaiting:` on pull requests, which `nav issue list` rejects rather than matching nothing. Single-valued keys OR their terms; multi-valued keys AND them. The `status:open` default belongs to the CLI's `list` verbs alone.
- **`$EDITOR`** opens whenever `-m` is absent; the buffer is the whole file, frontmatter included, and an abort leaves nothing behind.
- **Completions** for bash, zsh and fish, with IDs, directory names, feature slugs, document names and query keys supplied by `nav __complete`.
- **`nav install`** sets up the `git nav` alias, the pre-commit hook, `merge.directoryRenames=true` and completions, printing what it will do and asking first; `-y` skips the question; `nav uninstall` removes exactly what it added.
- **Budget** — a cold `nav issue list` over a thousand issues stays under 500 ms against the compiled build (spec 05 §5.2), and the test suite holds it at four times that against the sources.

## Where it lives

- `packages/cli/src/program.ts` (the tree), `commands/`, `install/`, `render/`
- Query grammar: `packages/core/src/core/query.ts`; JSON projection: `json.ts`

## Drift from the specification

- Spec 04 §4.3 lists `--edit` beside `-m` on the composing verbs. There is no such flag; the editor is the default when `-m` is absent.
- Spec 04 §4.3's `nav install` line does not list `--merge-config`, which exists and which spec 03 §3.3.1 and the README describe. The list under "Setup" is incomplete rather than wrong.
