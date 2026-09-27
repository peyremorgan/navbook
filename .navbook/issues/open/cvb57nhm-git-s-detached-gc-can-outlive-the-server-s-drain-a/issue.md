---
title: Git's detached gc can outlive the server's drain and leave lock files in the clone
author: Claude <noreply@anthropic.com>
created: 2026-09-27T12:52:10Z
assignee: Claude <noreply@anthropic.com>
labels: [bug]
---

Found in the self-review of #rcsql1v9. That issue is about zombies, which tini now reaps. This one is about the detached jobs themselves, which that fix leaves alone.

## What happens

After a commit or fetch, git starts `gc --auto` / `maintenance run --auto` in the background (`gc.autoDetach` and `maintenance.autoDetach` both default to true; the API image's git 2.54.0 sets neither). The detached job calls `setsid`, so it runs outside the server's process group and outside anything tini forwards signals to. That has two consequences:

1. **On `docker stop`:** `nav-server` drains its own in-flight git command and exits, then tini exits and the kernel SIGKILLs whatever gc is still running. If it held `packed-refs.lock` or a maintenance lock at that moment, the lock stays on the `clone` volume. The next start's ref updates then fail ("Unable to create '…/packed-refs.lock': File exists") until someone deletes it by hand.
2. **While running:** a gc that packs refs runs next to the server's own serialised commits and pushes, which can make a ref update fail with "cannot lock ref".

Not reproduced; this is reasoning from git's behaviour. It was the same before #rcsql1v9: without tini, the same SIGKILL arrives when Node exits.

## Options

- **`gc.autoDetach=false` + `maintenance.autoDetach=false`**, through the entrypoint's `git_config` (environment only, nothing written to the volume's config). The job then runs inside the git command the server waits on, so the drain covers it and the zombies stop at the source too. The cost is that an occasional commit or fetch takes as long as a gc. That blocks the serialised write queue and can hit `NAV_SERVER_GIT_TIMEOUT_MS` (30 s). The timeout's SIGTERM goes to the parent git only (`packages/core/src/git/exec.ts:160`), so a gc that is a child of that git would carry on as an orphan.
- **`gc.auto=0` + `maintenance.auto=false`**, and run `git maintenance run` from the server itself, between operations, under its own lock and timeout.
- **Leave it**, and have the entrypoint remove stale `*.lock` files at start. It already refuses to repair a clone, so that goes against its stated design.

## Acceptance

- [ ] `docker stop` during a forced `git gc` (for example `gc.auto=1`, then a push) leaves no `*.lock` under `.git/` in the volume, and the next start serves normally.
- [ ] No commit or push reported to a client fails with "cannot lock ref" because of a gc running beside it.
- [ ] Whichever option is chosen, the tini reaping from #rcsql1v9 stays in place as a backstop.
