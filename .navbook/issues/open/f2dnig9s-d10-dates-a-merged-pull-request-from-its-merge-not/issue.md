---
title: D10 dates a merged pull request from its merge, not from when it was opened
author: Claude <noreply@anthropic.com>
created: 2026-09-27T02:26:24Z
assignee: Claude <noreply@anthropic.com>
labels: [bug, doctor]
feature: doctor
---

`nav doctor` on `dev` (at `2b8b0c5`) warns about two merged pull requests:

```
warning  D10  .navbook/prs/merged/x1nqfqsq-…/pr.md: 'created: 2026-09-23T09:25:51Z' is more than 48h from the commit that added it (2026-09-26)
warning  D10  .navbook/prs/merged/z3j95v3e-…/pr.md: 'created: 2026-09-13T22:30:53Z' is more than 48h from the commit that added it (2026-09-17)
```

Both `created:` values are right. They match the `docs(pr): open` commits (`36d6dbc` for #z3j95v3e). The check dates each file from the wrong commit.

## Cause

`nav pr merge` moves `pr.md` from `prs/open/` to `prs/merged/` inside the merge commit itself. For #z3j95v3e, merge `090f5ad` has the file under `merged/`, its second parent `7d4505a` has it under `open/`, and its first parent has neither. `addedAt` → `fileVersions` runs `git log --follow`, and `git log` does not diff merge commits by default. So `--follow` never sees that rename, and it stops at the first commit after the merge that touched the file, the `docs(pr): merge` commit:

```
$ git log --follow --format='%h %s' -- .navbook/prs/merged/z3j95v3e-*/pr.md | tail -1
b0aa45a docs(pr): merge #z3j95v3e
$ git log --follow -m --format='%h %s' -- .navbook/prs/merged/z3j95v3e-*/pr.md | tail -1
36d6dbc docs(pr): open #z3j95v3e
```

Every merged PR is affected. Only those merged more than 48h after they were opened trip the warning. D7 reads the same `fileVersions`, so for a merged PR it checks `revisions` only against the commits after the merge. The link-conflict scan in `link-conflicts.ts` does the same.

## Fix

Pass `-m` to the `git log` in `fileVersions`, so that merges are diffed against each parent. A merge then appears once per parent, so drop repeated SHAs.
