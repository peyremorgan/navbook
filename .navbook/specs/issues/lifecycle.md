---
title: Lifecycle
---

## What exists

An issue is a directory `issues/{open,closed}/<id>-<slug>/` holding an `issue.md` and a `comments/` directory of one file per comment (spec 02 §2.5, §2.6). Every verb below is doable by hand with an editor and git; the CLI, the API and the web client run the same operations in `packages/core/src/ops/`.

- **Open** — `nav issue open <title>`, with `--label`, `--assignee`, `--milestone`, `--feature` and `--parent`. Without `-m`, `$EDITOR` opens on the composed file and what the buffer says is what counts: a title or parent edited there wins over the flag.
- **Comment and reply** — `nav issue comment <id> [--reply-to <comment-id>]`. Files sort chronologically by name; threads are flat files a renderer indents by `reply-to`.
- **Close and reopen** — a directory move, optionally recording `resolution:` and `duplicate-of:`. Reopening clears both.
- **Edit** — `nav issue edit` opens the real file; the edit is revalidated and recorded as `docs(issue): edit #id`.
- **Delete** — removes the directory outright, asking first only when it holds uncommitted changes. Subtasks survive as top-level issues unless `--recursive`, and each removed entity is named in a `Deletes:` trailer.
- **Decomposition** — `parent:` and `subtasks:` are both written, kept in step by `nav issue link`/`unlink`, and reconciled by doctor D11/D12. `parent` is authoritative; the tree nests to any depth.
- **Listing** — the query grammar of spec 04 §4.3, defaulting to `status:open` at the terminal only.

## Where it lives

- Planning: `packages/core/src/core/ops.ts`, `links.ts`
- Operations: `packages/core/src/ops/{entity,issue}.ts`
- CLI: `packages/cli/src/commands/{issue,entity}.ts`
- API: `openIssue`, `updateIssue`, `closeIssue`, `reopenIssue`, `addComment`, `linkIssue`, `unlinkIssue`
- Web: `/issues`, `/issues/new`, `/issues/[ref]`

## Drift from the specification

- Spec 04 §4.3 writes `[-m DESC | --edit]` on `issue open` and `issue comment`. No `--edit` flag exists: the editor opens whenever `-m` is absent. The behaviour is as specified; the flag is not.
