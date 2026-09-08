---
title: On-disk model
---

## What exists

The root directory defaults to `.navbook/` and carries a `navbook.json` marker so it can be found under another name (spec 02 §2.1, §2.10). It is located per command: `NAV_ROOT` when set to a relative path inside the repository, then `.navbook/`, then the marker — among the repository root's children and then among the paths git has staged, which is what finds a nested root. Two markers are an error, never a guess. Every path a tool reports is repository-relative and begins with the directory's actual name.

The marker is also read, not only found: its `review` object is the review policy of spec 02 §2.10 — `selfReview` and `minApprovals` — and it is the only part of the file anything interprets. `parseTree` hangs the reading on every `Repo`, so the tree and the policy that counts it arrive together, and the marker is therefore not among the reserved names below. Every key falls back to its default on its own and a marker that is not JSON falls back to both; D15 reports what was found, and nothing stops for it.

- **Files** are Markdown with YAML frontmatter at byte 0. Unknown keys, key order and comments survive a rewrite, and a file nothing changed is replayed byte for byte.
- **IDs** are eight random characters with a leading letter and at least one digit, minted without coordination; the slug beside one is display-only.
- **Status is the path**; no file carries a status key.
- **People** are RFC 5322 addresses, compared case-insensitively on the address.
- **References** are `#id` in prose and `Refs:`/`Closes:`/`Deletes:` trailers in commits. Trailers document intent and never change state.
- **Commits** that only touch the tracker use `docs(<scope>): <action> …`; a tracker-wide change uses bare `docs:`.
- **Merging** — distinct files for distinct actions is what keeps the common case conflict-free; `merge.directoryRenames=true` makes a comment racing a close merge clean; the first-comment race is repaired by doctor. Deletion is the one operation that does not compose.
- **Reserved** — `archive/<year>/…` is read as closed; `config.*`, `sync/`, `imported-from`, `imported-at` and `signature` are preserved untouched. An archived copy of the marker is reserved like anything else: only the live one is a policy.

## Where it lives

- `packages/core/src/core/{tree,files,frontmatter,slug,id,refs,person,time,policy}.ts`
- Root discovery: `packages/core/src/git/repo.ts`, `packages/core/src/workspace/ctx.ts`
- Spec: `doc/spec/02-data-model.md`, `03-merge-and-branches.md`

## Drift from the specification

- Spec 02 §2.4: tools comparing identities "SHOULD honor `.mailmap` if present". Nothing reads `.mailmap`; `personMatches` compares the address alone. A SHOULD left unimplemented rather than contradicted, but worth knowing for anyone whose address has changed.
