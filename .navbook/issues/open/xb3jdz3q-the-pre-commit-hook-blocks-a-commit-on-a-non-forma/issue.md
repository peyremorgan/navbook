---
title: The pre-commit hook blocks a commit on a non-format error when the existing hook uses set -e
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:35:56Z
labels: [bug, install]
feature: cli
---

`nav install --hooks` appends its block to whatever `pre-commit` hook already exists, which is right and is what spec 04 §4.5 asks for. But the block runs `nav doctor --staged` as a simple command and inspects `$?` on the next line:

```sh
if command -v nav >/dev/null 2>&1; then
  nav doctor --staged
  if [ $? -eq 2 ]; then
    exit 1
  fi
fi
```

Under `set -e` that is too late. The shell exits on the non-zero status before the `if` is ever reached, so **any** non-zero exit blocks the commit — not only exit 2.

`nav doctor` has three exit codes and only one of them means the tree is malformed: 0 clean or warnings, 1 operational error (no Navbook directory, two directories claiming the root, a bad `NAV_ROOT`), 2 format violation. The block's own comment states the contract it breaks: "Only a format violation (exit 2) blocks the commit; warnings never do."

## Repro

Two repositories, identical but for `set -e` in the pre-existing hook. In both, `.navbook/` is removed after `nav install --hooks`, so `nav doctor --staged` exits 1:

```sh
run_case() {
  git init -q -b main "$D"; cd "$D"
  printf '%s' "$PREFIX" > .git/hooks/pre-commit; chmod +x .git/hooks/pre-commit
  nav init --commit; nav install --hooks -y
  git rm -r -q --cached .navbook; rm -rf .navbook
  echo x > file.txt; git add file.txt
  git commit -q -m "add a file" >/dev/null 2>&1
  echo "commit exit=$?  head=$(git log --oneline -1 --format=%s)"
}
```

```
with-set-e:    commit exit=1  head=docs: initialize navbook
without-set-e: commit exit=0  head=add a file
```

The commit is lost in the first case. Nothing says the two are related: git prints `nav: not a Navbook repository`, which reads like a diagnostic rather than like the reason the commit was refused.

Exit 1 is reachable in ordinary use — a branch that predates `nav init`, a worktree checked out at such a commit, a stray `NAV_ROOT` in the environment, or a second directory that picked up a `navbook.json` marker.

## What it should do

The block should be immune to the caller's shell options rather than assuming there are none. Putting the invocation where `set -e` is suspended, or capturing the status without letting the shell act on it:

```sh
if command -v nav >/dev/null 2>&1; then
  status=0
  nav doctor --staged || status=$?
  if [ "$status" -eq 2 ]; then
    exit 1
  fi
fi
```

`set +e` at the top of the marked block is worth considering too: it is the only form robust against `set -eu -o pipefail` and against whatever the next revision of the block does, and it changes nothing for a hook that did not set it.
