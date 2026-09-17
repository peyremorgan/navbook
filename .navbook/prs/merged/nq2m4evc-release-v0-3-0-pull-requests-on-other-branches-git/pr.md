---
title: "Release v0.3.0: pull requests on other branches, git that waits, edits that notice each other, OIDC by discovery document"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-17T11:02:05Z
target: main
source: dev
labels: [release]
feature: [pull-requests, cli, server, web, gateway]
revisions:
  - head: b0aa45aadc817e1f7fa245aa14a88044b90682c1
    base: 46f7536cabffa826d42fe6d6a06d0325d03468c1
    date: 2026-09-17T11:02:05Z
merged:
  date: 2026-09-17T11:13:54Z
  by: Morgan PEYRE <morgan.peyre@brickcode.tech>
---

Releases v0.3.0: everything on `dev` since v0.2.0, the last version on npm.

#f2khcfyx already merged the first part of 0.3.0 into `main`, but `v0.3.0` was never tagged, so nothing was published. Since then #z3j95v3e has landed on `dev`: 22 commits, 8 of them code, 13 files outside `.navbook/`. This pull request brings it to `main` so it ships in the same release. All `package.json` files are already at 0.3.0, so this pull request changes no versions. The notes below replace #f2khcfyx's and cover the whole release.

# Release notes — v0.3.0

The server and the browser client now work together safely. `nav-server` no longer blocks while git runs, and an edit made against an out-of-date page is refused instead of silently overwriting someone else's change. The client can sign in to providers it could not use before. In the CLI, pull requests that live on other branches can now be found, shown and acted on, and `nav pr merge` also moves the source branch forward.

Published: `@navbook/core`, `@navbook/cli` and `@navbook/server` at 0.3.0. `@navbook/web` is built and shipped in its container image, but it is not published to npm.

## Upgrading

- **The OIDC provider is now set by its discovery document** (#hc9g6iog). An existing deployment needs a configuration change:
  - **Compose:** replace `NAVBOOK_OIDC_ISSUER` and `NAVBOOK_OIDC_JWKS_URL` in `.env` with one key, `NAVBOOK_OIDC_DISCOVERY_URL`. Both containers read it.
  - **`nav-server`:** `--oidc-discovery-url` / `NAV_SERVER_OIDC_DISCOVERY_URL` is now required. `--oidc-issuer` with `--oidc-jwks-url` is still accepted for a provider the server cannot reach at startup. The server refuses to start with `--oidc-issuer` alone, with only one of the two, or with either one next to a discovery URL.
  - **Web `config.json`:** `oidc.discoveryUrl` replaces `oidc.issuer`. The container image writes it from the environment.
- **The audience must be one of the provider's valid audiences** (#i6nzbn1d). The client now sends it as `resource` as well as `audience`. A provider that implements RFC 8707, such as Better Auth (`validAudiences`), answers `invalid_request` for an audience it does not list.
- **git calls have a time limit** (#i3fyesqd). `--git-timeout-ms` / `NAV_SERVER_GIT_TIMEOUT_MS` / `NAVBOOK_GIT_TIMEOUT_MS` defaults to 30 s. A fetch or push that takes longer is stopped, and that request fails with `SYNC_FAILED`. Set it to `0` to keep the old unlimited wait.
- **`nav pr merge` now also moves the source branch** (#en1bjq9j). See below. `--no-sync-source` keeps the old behaviour.
- **`--commit` refuses on a detached HEAD** (#mdftn010), for every issue and pull request command. It used to report the change as committed although no branch included the commit. The refusal names the branch at HEAD, and the worktree that has it checked out if there is one. Without `--commit`, nothing changes.
- **Some pull request commands now refuse where they used to fail differently** (#t4mwvm2j). Suppose a pull request lives only on another branch. `review`, `comment`, `edit`, `update` and `request` used to answer "no pull request matches" for it. They now exit 1 and say where to run instead. See below.

## Features

### Pull requests on other branches (#z3j95v3e)

A pull request's files live on its source branch. When every branch has its own worktree, a pull request could be found with `nav pr list --all-refs` and then not shown or reviewed with any ID the listing printed.

- **`nav pr show`** now reads a pull request from the branch that carries it when the current checkout does not. It names that branch on stderr and adds `refs` to `--json`. The pull request's reviews come from that branch too.
- **`review`, `comment`, `edit`, `update` and `request`** refuse instead of writing files that no `pr.md` sits beside. The refusal names the branch, the worktree that has it checked out, or the `git switch` that creates a local branch from a remote-only copy. The server already refused the same way. "No pull request matches" now means that no fetched branch carries the ID.
- **An empty `nav pr list` points at `--all-refs`.** When nothing matches on this branch but other branches carry open pull requests, it prints their count and the flag on stderr. Stdout and `--json` are unchanged.
- **`--all-refs` no longer lists merged or closed pull requests.** A source branch left over after a merge still holds the `prs/open/` copy. Now the pull request's target branch and the default branch decide whether it is settled. The stderr hint counts the same way, and it works on a detached HEAD.
- **ID arguments accept `#id` and entity paths**, the forms that listings and `--json` print: `nav pr show '#sf9fu6z4'`, or a `path` taken from `--json`.
- **In core:** `batchResolve` checks many `<ref>:<path>` specs with one `git cat-file`, and `lsTreeNamesOfTree` lists each distinct tree once. The GraphQL `pr` query now calls core's `readPr`, so the server and `nav pr show` look for a pull request in the same places.

### A slow push no longer stalls the server (#oifeg19c)

`nav-server` used to run git synchronously. While one person's push was in flight, the process could not serve the GraphiQL page, turn away a request with a bad token, or answer a health probe. The sync engine now waits on git asynchronously while holding the lock it already had. A slow push delays only the requests queued behind it. With a push stalled for 3 s, an unauthenticated request now gets its 401 in 7 ms instead of 2.8 s. A read that needs the lock still waits for the push, by design.

- **Timeouts:** a fetch or push that hits the timeout gets `SIGTERM`, then `SIGKILL` 2 s later. It is logged and reported to the client as `SYNC_FAILED`. `keptLocalCommit` tells the client whether the commit was kept locally. The next push sends it, so an operator has nothing to fix by hand. A git process that produces too much output is now stopped the same way.
- **In core:** `@navbook/core` gains `gitRunAsync`, `gitAsync` and `gitMaybeAsync`, a `GitTimeoutError`, and an `…Async` version of each sync operation. Each takes the same arguments and parses git's output the same way as its blocking version. The CLI's behaviour is unchanged.

### Stale edits are refused (#qwq7iwe9)

`updateIssue` and `updatePr` used to be last-write-wins on each field. If two people retitled the same issue, the last save silently won, even when its page was rendered before the first change.

- **API:** `Issue.baseSha` and `Pr.baseSha` return the blob hash of `issue.md` / `pr.md`. `UpdateIssueInput.baseSha` and `UpdatePrInput.baseSha` accept it back.
  - **The check:** when a hash is given, the update is refused with `STALE_CONTENT` only if a field the patch changes has changed since that version. `extensions.moved` lists those fields. A label added to an issue someone has just retitled still goes through.
  - **Optional:** when no hash is given, the update applies as before. Drag-to-rank in the inbox and toggles in listings send none.
  - **Unknown hashes:** a hash the clone cannot resolve counts as stale. It never causes a crash.
- **Web client:** both detail pages send the hash with every field save. When an edit is refused, the page reloads the record and keeps your edit in an alert. The alert gives the server's reason, shows what you typed, and offers *Save mine over it* and *Leave theirs*.

### Every pull request field can be edited in the browser (#zhbkqxr1)

A pull request's page used to let you change only its reviewers. It now edits the title, description, labels, assignees, features and milestone in place, like the issue page. On a branch the server does not hold, every editor is disabled, not only the one that was refused. `rank` and `deadline` stay issue-only.

### `nav pr merge` fast-forwards the source branch (#k3hxjngm)

The merge record used to be committed on the target branch only. Merging `dev` into `main` left `dev` one commit behind, and `nav pr list --all-refs` showed the same pull request as `merged` on `main` and `open` on `dev`.

- **What happens now:** after recording the merge, the source branch is fast-forwarded to the target, and the CLI prints `Fast-forwarded <source> to <target>`. `MergeResult.source` in core reports the outcome.
- **When it is skipped:**
  - Silently, for a remote-tracking ref or a branch that does not exist locally.
  - With a warning, for a branch that has commits the target lacks or that another worktree has checked out.
- **Safety:** it only ever fast-forwards. It never merges, commits or causes a conflict on the source branch.
- **Flags:** `--no-sync-source` turns it off. `--continue` performs the same step.

## Fixes

- **Web: sign-in against RFC 8707 providers** (#r5sbm79j, #i6nzbn1d). With Better Auth and similar providers, sign-in worked but every operation was then refused. No token request asked for the API as a `resource`, so the provider issued an opaque token that `nav-server` cannot verify.
  - **Every token request now asks for it:** the authorization URL, the code exchange and silent renewal. Renewal needed its own fix because oidc-client-ts ignores these settings on a refresh. A settings-only change would have broken again after about an hour.
  - **Array audiences:** the server now accepts a token whose `aud` is an array containing its audience. Better Auth sends one whenever `openid` is requested.
  - **Dev issuer:** it honours `resource` the same way.
- **Server and web: providers whose issuer has a path** (#kpz5ow8j, #hc9g6iog). Some providers publish their discovery document at the host root rather than under the issuer. The client could not find it for such a provider, and the server could not either unless the JWKS URL was given explicitly. Naming the discovery document fixes both.
- **Stale-edit check** (#qwq7iwe9). A self-review found three problems before release:
  - A read racing a write could return new hashes next to old field values, which let an edit get past the check. The hash is now computed from the exact text the record was parsed from.
  - A CRLF working copy counted as changed on every save.
  - The client could drop a kept edit after saving a different field.

## Documentation and specification

- **Specs:** spec 04 documents the source-branch fast-forward and `--no-sync-source`, and spec 01 mentions it. Spec 06 §6.3 describes the stale-edit check.
- **Server README:** removes the "last-write-wins" and "git is synchronous" statements, and documents `--git-timeout-ms` and the discovery URL.
- **Web README:** distinguishes editing a pull request's fields, which the API supports, from `nav pr update`, which appends a revision and which the API does not expose. It also covers identity provider requirements.
- **`.env.example` and `compose.yaml`:** use the renamed and new keys.

## Tests

- **Conformance:** a new `pr-merge` fixture covers `--no-sync-source`. The existing merge fixtures expect the new fast-forward line.
- **CLI:** new suites cover a pull request that only another branch holds, and `--all-refs` with settled and detached cases. Against the published `nav` 0.2.0, 7 of the 8 new cross-branch tests fail.
- **Server:** new suites cover responsiveness during a stalled push, stale edits, and discovery by URL. The config tests cover both provider shapes and the rejected combinations.
- **Web:** unit tests cover token requests against a stub provider, including a bare refresh, and the stale-edit helpers. The end-to-end suite now covers editing a pull request's fields.
- **Deploy:** the tests use the renamed key.
- **Gap:** the Playwright suite was not run on #oifeg19c, #qwq7iwe9, #r5sbm79j or #kpz5ow8j. The stale-edit alert's buttons have no end-to-end test yet.

## Before merging

- **Deployments:** set `NAVBOOK_OIDC_DISCOVERY_URL` in `.env` before running the 0.3.0 images. It replaces `NAVBOOK_OIDC_ISSUER` and `NAVBOOK_OIDC_JWKS_URL`. See Upgrading.
- **Push `main`:** local `main` is 80 commits ahead of `origin/main`, because #f2khcfyx's merge was never pushed. Push it along with this merge.
- **Publishing:** after the merge, tag `v0.3.0` on `main` and push the tag. That triggers `release.yml`, which checks the tag against the core, cli and server versions, already 0.3.0.
- **Still true from 0.2.0:** the API has no authorization beyond the token. `nav pr merge` blocks nothing: it warns when the review policy is not met, then merges anyway.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
