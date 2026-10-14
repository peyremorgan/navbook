---
title: "Release v0.6.0: test plans and an assistant, as plugins; the server writes on a pull request's own branch; the API image builds again"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T23:11:02Z
target: main
source: dev
reviewer: morgan.peyre@brickcode.tech
labels: [release]
revisions:
  - head: e3bce7e040fa017dbdf5e38296e8ee128265919b
    base: a2300427ca71d4d1a7967cf22e3fcac1b7df7a49
    date: 2026-10-06T23:11:02Z
merged:
  date: 2026-10-06T23:12:31Z
  by: Claude <noreply@anthropic.com>
---

Releases v0.6.0: everything on `dev` since v0.5.0, and the version bump.

That is 159 commits. 99 of them are tracker bookkeeping and 3 are merges. Of the other 57, 36 change code, tests or packaging, and 21 change only documentation and specification. Together they touch 238 files outside `.navbook/`. Twelve pull requests merged into `dev` in that time: #vi0kmykg, #qjxo5qqd, #nbo2fvc9, #ledhp62f, #fkjna1iy, #w5bf9713, #lfr46mfi, #g3xqbgn5, #x5nf9w0d, #z281l3xe, #vowcwya5 and #x8z1hhl3. The last two came out of the pre-release checklist. The last commit sets every `package.json` to 0.6.0. It also moves the three plugins' `@navbook/core` peer range, and the example in `doc/plugins.md`, to `^0.6.0`.

# Release notes — v0.6.0

Two new first-party plugins. `@navbook/plugin-tests` keeps manual test plans in the repository and records runs of them, on their own or attached to a pull request. `@navbook/plugin-chat` is an assistant: you ask about issues and pull requests in your own words, and it files, comments, reviews, opens and closes them once you approve each change. The server can now write a pull request on its own branch, so it comments on and patches pull requests the served checkout does not hold, and it opens pull requests. The Changes tab now shows code only, with the tracker's commits summarised at the foot. The API image builds again. The CLI's suites run under Git Bash on Windows, which found five real bugs.

Published: `@navbook/core`, `@navbook/cli`, `@navbook/server`, `@navbook/plugin-kb` and, new in this release, `@navbook/plugin-tests` and `@navbook/plugin-chat`, all at 0.6.0. `@navbook/web` is built and shipped in its container image, but it is not published to npm.

## Upgrading

- **Upgrade the plugins with `nav`.** The plugin API is now 1.1.0. plugin-tests and plugin-chat need it (`engines.navbook: ^1.1.0`), so a 0.5.0 `nav` or `nav-server` skips them and says why. All three plugins now name `@navbook/core ^0.6.0` as a peer. Run `nav plugin update` after upgrading `nav`. The API image checks the peer range when it is built.
- **The server pushes to pull request branches** (#yp56dc43, #lfr46mfi). Commenting on, reviewing or updating a pull request that another branch holds used to be refused. Now the server writes on the branch the pull request's `source:` names, and pushes that branch. Its credentials therefore need push access to pull request branches, not only to the served branch.
  - The write happens in a temporary worktree (`nav-server-wt-*` under the OS temp directory), on the server's own copy of the branch, `nav-server/<branch>`. The clone's local branches are never written, pushed or deleted. A copy holding an unpushed commit is kept and logged. Leftovers from a killed server are swept at startup.
  - The refusal that remains, when the source branch no longer carries the pull request, is `PRECONDITION` with `extensions.branch`. Its message no longer tells anyone to serve another branch.
- **`rebase-no-ff` keeps the source's own merge commits** (#z281l3xe). It replays with `git rebase --rebase-merges`, so a branch that integrated subtasks by merge commits lands with them intact. `rebase` still flattens. A conflict resolved inside a recreated merge, such as a "merge dev into X", comes back during the replay and stops for `nav pr merge --continue`.
- **A write through a symbolic link under `.navbook/` is refused** (#nbo2fvc9). `applyOps` no longer follows one.
- **Deploying.**
  - `NAVBOOK_PLUGINS` can now name `@navbook/plugin-tests` and `@navbook/plugin-chat`. Both images build and carry them. As before, the value is read at build time: `docker compose build && docker compose up -d`.
  - An entry keeps its version range. A workspace plugin is matched to its tarball by name. A name with no tarball in the workspace, such as `navbook-plugin-jira@^2`, goes to npm as written. Before, it was turned into a glob npm could not find.
  - The assistant reads three new keys: `NAVBOOK_CHAT_BASE_URL`, `NAVBOOK_CHAT_MODEL` and `NAVBOOK_CHAT_API_KEY`, passed to the API as `NAV_SERVER_CHAT_*`. With no model anywhere, the web client shows no assistant. The key is sent only to the endpoint the environment names, or to the default. While a key is set, an endpoint that only `navbook.json` names makes the assistant refuse to start.
  - The endpoint sees whatever the assistant reads out of the tracker to answer. Pick one you would show the tracker to.
- **Declaring is still separate from installing.** This repository's `navbook.json` declares only `@navbook/plugin-kb`. Declaring plugin-tests or plugin-chat would make the deployed API refuse to start until its image carries them.
- **On Windows** (#ledhp62f): `NAVBOOK_PLUGIN_PATH` is split on the platform's delimiter (`;`), not on `:`. `.gitattributes` keeps checkouts LF, with `*.cmd` as CRLF. The README has a *Developing on Windows* section.

## Features

### Test plans and test runs (`@navbook/plugin-tests`, #z9yqtsbv, #nbo2fvc9)

- **Format.** A plan is `tests/<slug>/plan.md`: a description, then one `### <title>` per step with `#### Actions` and an optional `#### Expected`. A run is a `<stamp>-<id>.md` file, under `tests/<slug>/runs/` or in a pull request's `tests/` directory, so it moves with the pull request. It records the plan and its SHA, the steps, a `commit` and/or a `version`, and a status and actual result per step. The outcome is derived, never stored. The normative spec is `packages/plugin-tests/doc/spec.md`, with checks X-tests-1 to X-tests-3.
- **CLI.** `nav test open|list|show|edit|run|record|resume|finish|runs|attach`. `run` walks the steps at a terminal and writes each answer as it is given. `nav pr show` gains a test runs section, and `nav pr list` gains `tested:`.
- **API.** `TestPlan` and `TestRun`, five mutations, `Pr.testRuns`, `Pr.tested` and a `tested` filter. Attachments travel as base64, up to 5 MiB per file in and 20 MiB out.
- **Web.** A `/tests` section, a structured plan editor, and a runner that keeps answers in the browser until **Save progress** or **Finish**. Each pull request has a test runs panel, its row a badge, and the filter bar a chip.

### An assistant (`@navbook/plugin-chat`, #s86nic83, #x5nf9w0d)

- **What it does.** It answers questions such as "what is assigned to me?" or "show me the overdue issues". It can also file, comment, review, open and close. Reads run at once. Each write is shown in full and waits for approval, and an approval answers only the write it was given for.
- **Models.** Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Ollama, vLLM, llama.cpp, LM Studio. The client tolerates the ways these servers really stream. Its errors read as words for a person, and the key is scrubbed from every message.
- **`nav chat`.** A line REPL with a streamed reply, `Apply? [y/N]` before each write, and `/help`, `/reset` and `/quit`. `-m` asks one question, and piped stdin joins it. `-y` applies without asking. `--json` emits NDJSON events and, without `-y`, declines writes. Configuration comes from `NAV_CHAT_*`, `--model` or `navbook.json`. The key comes from the environment only.
- **Web.** A round button in the lower right opens a side panel. Each write is an approval card, and an **Edits** selector switches between Manual and Allow all. A new conversation starts in Manual. Replies render `#id` references as links. An image in a reply is shown as a link, so displaying it fetches nothing.
- **Server.** `Query.chat` and a stateless `Subscription.chat` over SSE. The client sends the transcript, and the server validates it. Writes go through the host's own mutations. A browser that disconnects aborts the model call.

### The server writes on a pull request's own branch, and opens pull requests (#yp56dc43, #lfr46mfi)

- `addComment` and `updatePr` on a pull request held by another branch write on that branch and push it (see Upgrading).
- **`openPr(input: OpenPrInput!)`** opens a pull request on a branch already on the remote. `source` and `target` must be branch names (`feat~1` and `--octopus` are refused), and the target is read from the remote, not from a local branch that may be stale. The served branch and the default branch are refused as a source, and so is a branch with no `.navbook/`.

### Plugin API 1.1 (#g3xqbgn5, #nbo2fvc9)

- **Server.** `host.api.execute(ctx, document, variables)` runs a GraphQL operation as the request's viewer, through the same resolvers and mutation events as a client's request. It is refused under the repository lock, where it would wait for itself. `host.api.schema()` is the composed schema. `host.api.writeEntity` writes where `addComment` does, and `host.api.writeTarget` where the served checkout does.
- **CLI.** `ui.ask`, `ui.isInteractive`, `ui.editText`, `ui.withPrWriteSite` and `ui.withBranchWriteSite`. A verb that a plugin only completes no longer loads that plugin.
- **Core.** Entity locations let a plugin keep data inside an issue's or pull request's directory. There is a `write-bytes` op, and doctor gets tools to read blobs and check commits.
- **Web.** An `overlays` slot, rendered after every signed-in page. `PrRow` renders plugin row badges. `startStack({ pluginPaths, env })` lets a plugin's own e2e suite load it.
- **`nav pr open --source <branch> [-y]`** writes a pull request on another local branch, in the clean worktree that has it or in a temporary one.
- `doc/plugins.md` covers the write sites, `api.execute`, `overlays`, and the network rule of spec 04 §4.4.

### The Changes tab shows code; the tracker's commits are summarised below (#tj3a28x6, #qjxo5qqd)

- Tracker files leave the diff, its counts and the tab badge. A folded **Navbook activity** timeline at the foot has one sentence per tracker commit, such as `Commented on issue #id`, with fact chips and the commit's own diff on request.
- The summary is deterministic, from the commit's subject and files, with no model. It is in core (`activity.ts`), and the API serves it as `Pr.activity` and `ChangedFile.tracker`.
- A revision that changes only the tracker says so, rather than "changes nothing".

### Smaller

- **The PR list's empty state** links "try every fetched branch" to the same filter with `refs=all` (#h8jxhiz6, #w5bf9713). It is offered only when the status filter lets an open pull request through.

## Fixes

- **The API image did not build** (#uniyh2hy, #vi0kmykg). This failed in `docker compose build`, the CI `docker` job and the deploy recipe ever since the plugin merge. The build stage now installs every packed package's workspace dependencies. The runtime install passes `--legacy-peer-deps`, as `nav plugin install` does, and `check-plugin-peers.mjs` checks the `@navbook/core` peer range in its place. The deploy tests now pin both.
- **plugin-chat declared the wrong plugin API** (#vowcwya5). It said `^1.0.0` but calls four seams that are new in 1.1. A 0.5.0 host would have loaded it and failed at the first missing function.
- **`fileVersions` lost the version a merge committed** under git 2.56, which follows a rename through a merge without listing the merge (#ledhp62f). This affects any machine with a new git, not only Windows.
- **On Windows** (#ledhp62f):
  - every `nav plugin` verb failed, because `npm.cmd` could not be launched;
  - `$EDITOR` never received its file;
  - a `C:\...` path was read as a URL;
  - a grouped git command could not be stopped;
  - an early git exit was reported as "spawnSync git EOF".
- **Merging read a stale copy of a pull request** that sat on several branches (#g3xqbgn5). The copy on its `source:` branch now answers.
- **Found in the self-reviews** of #lfr46mfi, #g3xqbgn5 and #x5nf9w0d, before any of it shipped:
  - a server write landing on whichever branch sorted first;
  - `execute` deadlocking the server under the lock;
  - an approval reused for the next, unseen write;
  - Allow all overriding a Decline;
  - a committed `baseUrl` receiving the key.
- **Biome** rejected `TestStateBadge.vue` (#fkjna1iy).

## Documentation and specification

- **Spec 02 §2.10 and spec 04** say which replay flattens and which keeps merges.
- **Spec 04 §4.4:** the verbs that read or write the tree make no network call. A plugin's own command may reach a service it is configured for, and must say so.
- **Spec 06:** most checkout-centric verbs are not exposed, plus a paragraph on writing on the branch.
- **Plugins:** `doc/plugins.md` lists the three first-party plugins and the 1.1 seams. `packages/plugin-tests/doc/spec.md` and `packages/plugin-chat/doc/assistant.md` (the prompt) are new.
- **Setup:** the README gains *Developing on Windows*, and `.env.example` documents the chat keys and the three plugins.

## Tests

At `e3bce7e` (this pull request's head), on a fresh clone with Node 24.21 and pnpm 11.18.0, every step of `release.yml` short of the publish was run:

| Step | Result |
|---|---|
| tag check: all six packages at 0.6.0 | passed |
| `pnpm install --frozen-lockfile`, `pnpm check`, `codegen:check` | passed |
| core | 956 passed |
| cli | 437 passed |
| server | 491 passed, 1 skipped, 1 failed (below) |
| plugin-kb / plugin-tests / plugin-chat | 145 / 120 / 149 passed |
| web unit (vitest) | 427 passed |
| conformance, from source / built CLI / installed package | 128/128 each |
| deploy | 82 passed (78 before `pnpm build`: four cases need its output) |
| `pnpm build`, and the bench against the built CLI | passed |
| six tarballs packed at 0.6.0 | passed |
| consumer smoke test | passed: `nav --version` is 0.6.0, all three plugins install from their tarballs and run, `nav chat` without a model refuses and names `NAV_CHAT_MODEL`, `nav-server --help` resolves |
| Playwright, against a bundle built from this commit | 196 passed |

The one failure is `maintenance.test.ts` › "packs what it finds…". It depends on the git version. Apple Git 2.50.1 runs `maintenance run --auto` as `gc --auto`, which needs about 6,700 loose objects, and the test makes 3,000. The test is unchanged since v0.5.0, and it passed on CI's Linux runners then.

## Before merging

- **CI has not run on any of this.** CI runs on pushes to `main`, so this is the first run of `dev` since v0.5.0 on CI's macOS, Windows and docker jobs. Every `main` run since v0.4.0 failed the docker job; its fix (#vi0kmykg) is in this release. The agreed plan is to fix what CI finds after the push.
- **Two packages are new to npm.** `@navbook/plugin-tests` and `@navbook/plugin-chat` have never been published. If `NPM_TOKEN` cannot create a package, `release.yml` fails after core, cli, server and plugin-kb are out, and the two would need publishing by hand.
- **Pushing.** Local `main` fast-forwards to `origin/main` and then, with no merge method declared, to `dev`. Tag `v0.6.0` on `main`, then push `main`, `dev` and the tag. The tag triggers `release.yml`, which checks it against all six package versions.
- **Still true:** `nav pr merge` blocks nothing over reviews. It warns when the review policy is not met, then merges anyway.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
