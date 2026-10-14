---
title: "maintenance.test.ts fails on git 2.56: geometric repack no longer triggers at 3000 loose objects"
author: Claude <noreply@anthropic.com>
created: 2026-10-14T00:02:42Z
assignee: Claude <noreply@anthropic.com>
labels: [bug]
feature: server
---

`packages/server/test/unit/maintenance.test.ts` ("Maintenance against git" → "packs what it finds, in the foreground, whatever git would otherwise do") fails on git 2.56.0. It fails alone and in full runs, on `dev` as of `b73bde6c`:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

3003 !== 0
    at TestContext.<anonymous> (test/unit/maintenance.test.ts:303:14)
```

It passed on git 2.55, and this machine's git was upgraded between the two runs. It is not a load or timing failure: `node --test --test-name-pattern="packs what it finds" test/unit/maintenance.test.ts` fails every time.

## Cause

Git 2.56's release notes:

> The threshold for geometric repacking to trigger based on loose object count has been adjusted to match that of 'git gc --auto', preventing over-aggressive repacking during concurrent writes.

The test makes 3000 loose objects and expects `git maintenance run --auto` (`MAINTENANCE_ARGS` in `packages/server/src/maintenance.ts`) to pack them. With 2.56, the default geometric-repack task only triggers at gc's threshold, 6700 by default. So `--auto` now decides there is nothing to do: it exits 0, starts no child, and leaves every object loose.

Reproduced outside the suite, with git 2.56.0 and no global or system config:

```sh
git init -q -b main && mkdir files
for i in $(seq 0 2999); do echo "blob $i" > files/$i; done
git add files && git -c user.name=t -c user.email=t@t commit -qm many
git -c gc.autoDetach=false maintenance run --auto --quiet
git count-objects                                   # 3003 objects
git -c maintenance.geometric-repack.auto=100 -c gc.autoDetach=false maintenance run --auto --quiet
git count-objects                                   # 0 objects
```

`gc.auto=100` and `maintenance.gc.auto=100` do not change it. `maintenance.geometric-repack.auto` is the setting that matters.

## What to do

What the test is about is still true: the run stays in the foreground, and by the time `stop()` returns it has finished. Only the amount of work needed to trigger it moved. Two ways to fix it:

- **Recommended:** add `maintenance.geometric-repack.auto=100` to the test's `GIT_CONFIG_*` entries. The test then no longer depends on a default git keeps tuning, and stays as fast as it is. Older gits ignore a key they don't know.
- Make more than 6700 loose objects. That's slower, and breaks again the next time the default moves.

Production is not broken, but it does behave differently: on git 2.56 the server's periodic maintenance packs loose objects only once there are about 6700 of them, which is git's own judgement now. If that matters for the deployed clone, the server could pass its own `maintenance.geometric-repack.auto` in `MAINTENANCE_ARGS`. That's a separate decision from the test fix.
