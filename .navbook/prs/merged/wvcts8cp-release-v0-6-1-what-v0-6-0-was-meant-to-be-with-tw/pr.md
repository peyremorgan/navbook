---
title: "Release v0.6.1: what v0.6.0 was meant to be, with two test fixes"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T23:49:18Z
target: main
source: dev
reviewer: morgan.peyre@brickcode.tech
labels: [release]
revisions:
  - head: 9b41be4caa4a4e431c6bb92446ef63178fae1e15
    base: 84a2eddf331e3c65731c7caf362c1c4edd769534
    date: 2026-10-06T23:49:18Z
merged:
  date: 2026-10-06T23:49:22Z
  by: Claude <noreply@anthropic.com>
---

Releases v0.6.1. That is v0.6.0 (#n6vu3l42) and two test fixes. v0.6.0 was tagged and merged into `main` but never published: `release.yml` failed at `pnpm test`, before its first publish step, so npm has no 0.6.0 of any package.

The release notes are those of #n6vu3l42, which still describe everything this release ships. The 0.6.1 additions are below. Read "0.6.0" in those notes as "0.6.1": the plugins' `@navbook/core` peer range is now `^0.6.1`.

# What changed since v0.6.0

Both fixes are to tests. No shipped code changed.

- **#hfyrd8gz: a server test left `TMPDIR` set to the string `"undefined"`.** Where `TMPDIR` was unset, as on CI's Ubuntu runners, restoring it by assignment stored `"undefined"`, and the next test made its worktree under `./undefined`. That failed the release run, both Ubuntu test jobs and the built-server suite. The restore now deletes the variable when it was unset.
- **#u20nlf3l: a CLI test named its temp directory only for POSIX.** On Windows, `os.tmpdir()` reads `TEMP` and then `TMP`, never `TMPDIR`, so the plugin write-site test looked for its kept worktree in the wrong place. That failed CI's Git Bash job. The test now sets all three.
- **The version bump.** Every `package.json` goes to 0.6.1, and the three plugins' `@navbook/core` peer range, the `doc/plugins.md` example and the README's `nav plugin list` example follow.

# Tests

On a fresh clone of `9b41be4`, this pull request's head, with Node 24.21 and pnpm 11.18.0:

| Step | Result |
|---|---|
| tag check: all six packages at 0.6.1 | passed |
| frozen install, `pnpm check`, `codegen:check` | passed |
| core / cli / plugin-kb / plugin-tests / plugin-chat, with `TMPDIR` unset as on Ubuntu | 956 / 437 / 145 / 120 / 149 passed |
| server, with `TMPDIR` unset | 491 passed, 1 skipped, 1 failed: the maintenance packing test, which fails with Apple Git 2.50.1 (see #n6vu3l42) |
| conformance, from source / built CLI / installed package | 128/128 each |
| deploy | 78 passed (before `pnpm build`; 82 after) |
| `pnpm build`, and six tarballs packed at 0.6.1 | passed |
| consumer smoke test | passed: `nav --version` is 0.6.1, and all three plugins install and run |

Playwright was not run again: nothing under `packages/web` changed since #n6vu3l42's 196/196.

CI on `main` at v0.6.0 (84a2edd) passed the container images (for the first time since v0.4.0), lint and typecheck, web e2e, and both macOS test jobs. The Ubuntu and build-and-pack failures were #hfyrd8gz. The Windows failure was #u20nlf3l.

# Before merging

- **Windows ran only part of its tests.** At 84a2edd the Git Bash job stopped at the CLI, so plugin-kb, plugin-tests and conformance have not yet run on Windows. Fixing #u20nlf3l lets them run, and they may turn up something new. The release workflow runs on Ubuntu only, so that does not block publishing.
- **Two packages are new to npm**, as #n6vu3l42 says: `@navbook/plugin-tests` and `@navbook/plugin-chat`.
- **Pushing.** With no merge method declared, `nav pr merge` fast-forwards `main` to `dev`. Tag `v0.6.1` on `main`, then push `main`, `dev` and the tag. `v0.6.0` stays where it is.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
