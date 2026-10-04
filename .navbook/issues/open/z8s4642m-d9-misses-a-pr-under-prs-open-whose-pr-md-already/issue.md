---
title: "D9 misses a PR under prs/open/ whose pr.md already records merged:"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-10-04T22:32:21Z
labels: [bug, doctor]
feature: doctor
---

D9 (merged but not archived, 03 §3.5) misses a pull request that is plainly merged: one under `prs/open/` whose `pr.md` already carries a `merged:` block. A rebase of the target branch leaves pull requests in exactly this state (#m7w6eqk3). D9 has two conditions, and that case fails both:

- **It only runs on the pull request's target branch** (`pr.fm.target !== branch` → skip). The misfiled copy usually travels further, onto `dev` or the default branch, where the target is some `rel/*` or `w0/*` branch, so D9 never looks at it.
- **It decides "merged" by ancestry of the latest revision's head.** After a rebase that head is a pre-rebase commit, which is not an ancestor of the rewritten history, so even on the target the check stays quiet.

In the brickcode factory repo, `nav doctor` on `dev` reported 0 errors and no D9 warning while 12 pull requests sat under `prs/open/` with `merged:` blocks. `nav pr list --all-refs` listed all 12 as open, because `dropSettledOnTarget` reads the directory too.

## Expected

- A tree-only check: a `pr.md` under `prs/open/` that carries `merged:` is an error on any branch, the way D4 treats one entity in two status directories, because the file contradicts its directory. It needs no history, so it also runs under `--staged`.
- `--fix` offers the move D9 already plans (`planD9Fix`), so `nav doctor --fix` repairs it.
- Optionally, `--all-refs` listing (`dropSettledOnTarget` / `settledPrIds`) also treats an open copy that carries `merged:` as settled, so the list stops reporting it before anyone runs doctor.

The same reasoning applies to `closed:` / `resolution:` under `prs/open/`, if `nav pr close` writes those.
