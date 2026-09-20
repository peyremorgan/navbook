# 02 — The pre-commit hook blocks a commit on a non-format error

**Tracked as:** `#xb3jdz3q` — `nav issue show xb3jdz3q`
**Severity:** High — a commit is silently refused, and the rule the hook breaks
is the one it documents in its own body.
**Where:** [`packages/cli/src/install/hook.ts:28-38`](../../packages/cli/src/install/hook.ts#L28-L38)

## What is wrong

The block `nav install --hooks` appends is:

```sh
# >>> navbook >>>
# Validate staged Navbook files. Only a format violation (exit 2) blocks the
# commit; warnings never do, and a clone without nav installed is unaffected.
# Commit with --no-verify, or delete this block, to skip the check.
if command -v nav >/dev/null 2>&1; then
  nav doctor --staged
  if [ $? -eq 2 ]; then
    exit 1
  fi
fi
# <<< navbook <<<
```

`nav doctor --staged` runs as a simple command on a line of its own, and its
status is inspected afterwards. Under `set -e` that is too late: the shell exits
on the non-zero status before the `if` is ever reached.

The installer *appends to whatever hook already exists* (`installHook`,
`hook.ts:50-62`), which is the right behaviour and is what spec 04 §4.5 asks
for. But a pre-commit hook that begins `#!/bin/sh` + `set -e` is an extremely
ordinary thing to find, and the appended block then inherits it.

## Why it matters

`nav doctor` has three exit codes, and only one of them means the tree is
malformed:

| Exit | Meaning | Should it block? |
|---|---|---|
| 0 | clean, or warnings only | no |
| 1 | operational error — no Navbook directory, two directories claiming to be the root, a bad `NAV_ROOT` | **no** |
| 2 | format violation | yes |

Spec 04 §4.5:

> installs a `pre-commit` hook that runs `nav doctor --staged` and blocks the
> commit on errors (exit 2) **only** — warnings never block.

Under `set -e`, exit 1 blocks too. The failure is quiet in the worst way: git
prints nav's message, the commit does not happen, and nothing says the two are
related — `nav: not a Navbook repository` reads like a diagnostic, not like the
reason the commit was refused.

Exit 1 is reachable in ordinary use: somebody removes `.navbook/` from a branch,
a second directory picks up a `navbook.json` marker, `NAV_ROOT` is exported in a
shell and points somewhere that does not exist, or a worktree is checked out at
a commit that predates `nav init`.

## Reproduction

Two repositories, identical but for `set -e` in the pre-existing hook:

```sh
run_case() {
  NAME=$1; PREFIX=$2
  git init -q -b main "$D"; cd "$D"
  printf '%s' "$PREFIX" > .git/hooks/pre-commit; chmod +x .git/hooks/pre-commit
  nav init --commit
  nav install --hooks -y
  git rm -r -q --cached .navbook; rm -rf .navbook   # make doctor exit 1
  echo x > file.txt; git add file.txt
  git commit -q -m "add a file" >/dev/null 2>&1
  echo "$NAME: commit exit=$?  head=$(git log --oneline -1 --format=%s)"
}
run_case "with-set-e"    '#!/bin/sh\nset -e\necho existing\n'
run_case "without-set-e" '#!/bin/sh\necho existing\n'
```

```
with-set-e:    commit exit=1  head=docs: initialize navbook
without-set-e: commit exit=0  head=add a file
```

The commit is lost in the first case and made in the second. `nav doctor
--staged` exits 1 in both.

## Suggested fix

Make the block immune to the caller's shell options rather than hoping it is not
under any. Putting the invocation inside the `if` is enough — `set -e` is
suspended for a command in a condition, by POSIX rule:

```sh
if command -v nav >/dev/null 2>&1; then
  if nav doctor --staged; then
    :
  elif [ $? -eq 2 ]; then
    exit 1
  fi
fi
```

Or, more plainly, capture the status in a way `set -e` does not act on:

```sh
if command -v nav >/dev/null 2>&1; then
  status=0
  nav doctor --staged || status=$?
  [ "$status" -eq 2 ] && exit 1
fi
```

The second reads better and says what it means. Note that `[ ... ] && exit 1` as
the *last* command of the block would make the hook's own exit status 1 when the
test is false, so keep the `exit 0` implicit by leaving the `fi` after it — or
write it as a full `if`.

It is also worth considering `set +e` at the top of the marked block. That is
the only form that is robust against a hook using `set -eu -o pipefail` and
against whatever the next revision of the block does, and it changes nothing for
a hook that did not set it.

## Test gap

`packages/cli/test/cli/install.test.ts` covers that the block is appended and
removed exactly. It does not run the resulting hook. A test that writes a
`set -e` hook, installs the block, and asserts a commit still lands when
`nav doctor --staged` exits 1 would pin the contract the block's own comment
states.
