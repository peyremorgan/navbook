---
title: Release review of dev since v0.4.0, and its fixes
author: Claude <noreply@anthropic.com>
created: 2026-09-29T02:57:24Z
target: dev
source: fix/release-review
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: a331ea36eb72c2b9ecaaa0f0a6713d43ed7dd1b4
    base: ff53cbc9a2fb1f3ff55851b3ac1f6cb6c2153900
    date: 2026-09-29T02:57:24Z
  - head: 97487e8ef603765348e351556426da1a6b0b795d
    base: 7083ddd12cb4c77d958683a4540c86f9613f9391
    date: 2026-09-29T09:16:17Z
merged:
  date: 2026-09-29T10:28:37Z
  by: Claude <noreply@anthropic.com>
---

A release review of everything `dev` carries since v0.4.0 (`b93ca76`), pinned at `6842e4d`, and a fix for every issue it found that could be fixed without a decision. Seven reviewers covered core, CLI, server and ops, plugin-kb, web, and spec, docs and packaging. Each finding was reproduced before it was fixed, and each fix has a test that fails without it, except where noted.

## Blockers fixed

- **Push access became code execution on the API.** The server passed each name declared in `navbook.json` to `require.resolve`, so an absolute or relative path loaded a plugin from the served clone itself. It now accepts only names that fit npm's whole package-name grammar, since a prefix check let `navbook-plugin-a/../../<clone>` through. The resolved folder must be `node_modules/<name>`, and the package must carry that name and the plugin keyword.
- **Bad `feature:` values were committed.** When `feature:` moved into plugin-kb, the write paths stopped passing the extensions to `validateIssue`/`validatePr`. The API and `nav issue open`/`pr open` committed values that doctor then rejected, and the API served them as no features. The argument is now required.
- **Every web build carried plugin-kb.** The web scripts set `NAVBOOK_WEB_PLUGINS` outright and overrode the image's build argument. Against an API without kb, filing an issue failed. The scripts now only default it when it is unset.
- **One odd branch broke every cross-branch PR lookup.** A branch with a file or a symlink at `prs/open` made `pr list --all-refs`, the merge lookup and the other-branches hint throw for everyone.

## Other fixes, by package

**core**
- The fast frontmatter reader treated NBSP and other Unicode whitespace as YAML's. It dropped trailing NBSP from values and passed invalid YAML that every write then refused.
- Prose references follow CommonMark as markdown-it renders them: fences in containers, indented code, list markers, setext and thematic breaks, and tables. Finding code spans is now linear rather than quadratic. A differential fuzz against markdown-it went from ~16,900 divergences per 100k documents to 0 on block structure.
- Plugin registrations may not claim built-in directories, keys, query terms or check ids, or path-like names. A registry that is not a list is reported against the plugin rather than crashing every command.
- `satisfiesRange` reads ranges as npm does: space-separated, hyphen and partial ranges, `^0.0.x`, and prereleases. It agrees with semver 7 on ~660k pairs.
- `format.grandfathered` lifts the namespace rule for `specs/` and `feature:` only.
- A gitlink in `catObjects`, an unreadable `comments/`, and a branch named like a `git worktree` option are handled.

**server**
- Shutdown aborts the background fetch, with its child processes, instead of waiting for it.
- A port that cannot be had is a startup error that stops what was started.
- The API gets a 75 s stop grace period, enough for a fetch and a push at the default git timeout.
- The docs say when a mutation event reports `pushed: false`.

**CLI**
- `plugin install` records what npm actually installed, including versioned and local reinstalls. It keeps versions and URLs as typed, falls back to `navbook-plugin-<name>`, and works outside a repository. `remove` and `update` take short names.
- Contributed options reach shared verbs, and plugin columns and JSON keys reach `pr list` without replacing built-in keys.
- `--commits` refuses `0x10` and `1e1` again.
- `nav install --hooks` updates an outdated hook block.
- A missing plugin says "could not be loaded", and a plugin that throws while registering is skipped and named.

**plugin-kb**
- `feature open` and `spec add` refuse to overwrite an unparseable file.
- The stale check is per field, so a second quick edit is not refused against your own first.
- Slugs are stored once, the timeline count is fixed, and the server half no longer imports `@navbook/server` at runtime.

**web**
- Sign-out no longer asks the leave question again on Back from the provider, and waits for an in-flight token renewal.
- One "Discard and leave" answers the browser's prompt too, and a failed re-sign-in no longer leaves a silent agreement.
- The plugin panel is disabled with the rest of the PR page.
- Plugin filters stay on their own noun.
- Other fixes cover save toasts, the order of plugin fields on the new-issue form, and a false leave prompt from an untouched editor.

**tests and docs**
- The conformance suite skips plugin cases only when `NAV_SKIP_PLUGINS` asks.
- `format/valid/features` now actually loads the plugin.
- `.env.example` says the web image compiles only workspace plugins.

## Not fixed here: needs a decision or is already in flight

- **Version bump.** Everything is still `0.4.0`, though `@navbook/core` dropped the feature exports. The next version, plugin-kb's `@navbook/core` peer range and the upgrade notes are the release's to decide.
- **The API image does not build (`#uniyh2hy`).** PR `#vi0kmykg` fixes it and is waiting for review. It also carries the Dockerfile, which is why the next item is not fixed here.
- **The API Dockerfile's plugin loop** turns `@navbook/plugin-kb@^0.5`, or any registry-only `@navbook/plugin-*`, into a tarball glob that fails `npm install`.
- **Third-party plugins in the web image.** The web build installs nothing from the registry. Supporting them is a design question, so this PR only documents the limit.
- **Lower-priority notes:**
  - Plugin-kb's completions-only contribution makes plain `issue list` load its core.
  - Comments that the API reads lazily are read outside the lock that loaded the entity.
  - Four of the web fixes have no unit test, because they live in middleware, plugins and components. The full e2e suite covers the flows they touch.

## Second review

A second pass reviewed this branch's own diff for regressions the fixes introduced. It found four, all fixed here with tests that fail without the fix:

- The prefix-only name check left the path bypass above open.
- `plugin install` turned an `https://…/x.tgz` URL into a local path.
- A leave agreement outlived a navigation whose guard threw.
- 45 s did not cover a mutation's fetch and push.

## Checks

At the head of this branch:

- `biome` and `tsc` pass for every package, including `nuxi typecheck`.
- Codegen in server, web and plugin-kb leaves no diff.

| Suite | Result |
|---|---|
| core | pass |
| server | pass |
| plugin-kb | pass |
| CLI | pass |
| web unit | pass |
| conformance | pass |
| deploy | pass |
| web e2e (web and plugin-kb) | 169/169 |

Two tests failed only where two fixes met: an `ext` prototype comparison and a loader message. Both were fixed on the branch and rerun.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
