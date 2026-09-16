---
title: Refuse an edit to an issue or pull request field somebody else changed first
author: Claude <noreply@anthropic.com>
created: 2026-09-16T11:14:36Z
target: dev
source: fix/hslxi9a3-stale-field-edits
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
feature: [server, web, issues]
revisions:
  - head: 070f905dacf5ff4b7d33e1342570641ce0e30b11
    base: e163c39f85e26b1f8b4af6cacd84a0e0a5f97c61
    date: 2026-09-16T11:14:36Z
  - head: 947dcd4e50c146000181ee0af9a0c6d240e2bf70
    base: e163c39f85e26b1f8b4af6cacd84a0e0a5f97c61
    date: 2026-09-16T17:22:56Z
  - head: aec0a1528452a2b4bf4446a4b98424831dbde798
    base: 3f98070c239afe3a04578760b063b4ea9ae4d768
    date: 2026-09-16T17:24:56Z
---

Closes #hslxi9a3.

`updateIssue` and `updatePr` were last-write-wins on the same field. The patch is field-scoped, so two people changing *different* fields already survived each other; the gap was A retitling, B retitling from a page rendered before A's change, and B winning silently. Confirmed black-box in the issue's comment.

## What changes

**Server.** `Issue.baseSha` and `Pr.baseSha` report the blob hash of `issue.md` / `pr.md`, hashed under the repository lock the way `Feature.commits` reads, and once per record the way `Feature.baseSha` is. `UpdateIssueInput.baseSha` and `UpdatePrInput.baseSha` take it back, **optionally**: absent is today's behaviour, which is what the inbox's drag and any listing toggle want. Present, `patchEntity` reads the base version with `git cat-file blob` (new `blobContent` in core, which only lets a hash-shaped string reach git), and `movedFields` compares the two versions on the fields the patch names and nothing else, through the same readers the resolvers use — so `assignee: A` and `assignee: [A]` are one value, and a label set on a retitled issue lands. The refusal is `STALE_CONTENT` with `extensions.moved` naming the fields, before anything is validated or written. A hash the clone cannot resolve is stale by definition, never a crash.

**Web.** Both detail pages send the hash with every field save. On refusal the page is fetched again and the refused edit is kept in a new `StaleEditAlert` — which field moved, what you typed — with *Save mine over it* (resend against the fresh hash) and *Leave theirs*. The inbox sends no hash and is never asked. `staleEdit()` in `utils/errors.ts` reads the refusal; `describeEntityEdit()` in `utils/patch.ts` renders the kept edit.

**Docs.** The server README's "last-write-wins" sentence is gone and the `updateSpec`/`updateFeature` bullet has a sibling; spec 06 §6.3 and the web README each gain a paragraph.

## Tests

- `packages/server/test/server/stale.test.ts`: hash reported and moves with the file (and equals `git hash-object`); a moved field is refused and the tree, the commit count and `git status` are untouched; an unmoved field lands with a stale hash; several moved fields are all named; the same edit goes through with the fresh hash; no hash still lands; `0…0`, `whatever`, `""` and `-p` are refused as stale; the stale check runs before validation; a pull request served from its own branch is guarded the same way.
- `packages/server/test/unit/patch.test.ts`: `movedFields` and `namedFields`, including respelling, cleared keys, trimmed body, rank/deadline readings.
- `packages/web/test/nuxt/{errors,patch}.test.ts`: `staleEdit` and `describeEntityEdit`.

Ran in the worktree: `tsc --noEmit` for core, cli, server; `nuxi typecheck`; `biome check .`; core (696), server (276) and web (296) suites. Not run: the Playwright suite, so the alert's two buttons have no end-to-end coverage yet; the `data-testid`s (`stale-edit`, `stale-mine`, `stale-reapply`, `stale-dismiss`) are there for one.

## Worth a look

- `hashOf` in `resolvers/entity.ts` is one `git hash-object` per entity that asks. Only the detail fragments ask, so a listing costs nothing; if a list view ever needs it, batch per `Repo` as features batch per record.
- The base blob is looked up by hash alone, so a hash minted by another server against the same origin also resolves once fetched — that is the "reachable as long as it came from this server" property, and a little more.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
