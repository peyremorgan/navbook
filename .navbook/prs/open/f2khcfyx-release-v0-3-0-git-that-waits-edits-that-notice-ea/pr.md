---
title: "Release v0.3.0: git that waits, edits that notice each other, and OIDC by discovery document"
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-16T21:27:50Z
target: main
source: dev
labels: [release]
feature: [server, web, gateway, pull-requests]
revisions:
  - head: a7942c997148706b4dc154d69b19dcf3a7a89d3b
    base: eb7fb51b11700489c0a8c13354b3b6ee579b35ff
    date: 2026-09-16T21:27:50Z
---

Releases v0.3.0: everything on `dev` since v0.2.0, 77 commits and 146 files, of which 48 are tracker records. Six pull requests landed: #zhbkqxr1, #oifeg19c, #k3hxjngm, #qwq7iwe9, #r5sbm79j and #kpz5ow8j. The last commit bumps all five `package.json` files from 0.2.0 to 0.3.0, so the `v0.3.0` tag matches what `release.yml` checks.

# Release notes — v0.3.0

This release is mostly about the server and the browser client working together safely. `nav-server` no longer blocks while git runs, and an edit made against an out-of-date page is refused instead of silently overwriting someone else's change. The client now signs in to providers it could not use before. The CLI gains one behaviour change to `nav pr merge`.

Published: `@navbook/core`, `@navbook/cli` and `@navbook/server` at 0.3.0. `@navbook/web` is built and shipped in its container image, but it is not published to npm.

## Upgrading

- **The OIDC provider is now set by its discovery document** (#hc9g6iog). An existing deployment needs a configuration change:
  - **Compose:** replace `NAVBOOK_OIDC_ISSUER` and `NAVBOOK_OIDC_JWKS_URL` in `.env` with one key, `NAVBOOK_OIDC_DISCOVERY_URL`. Both containers read it.
  - **`nav-server`:** `--oidc-discovery-url` / `NAV_SERVER_OIDC_DISCOVERY_URL` is now required. `--oidc-issuer` with `--oidc-jwks-url` is still accepted for a provider the server cannot reach at startup, but the server refuses to start with `--oidc-issuer` alone, with only one of the two, or with either one next to a discovery URL.
  - **Web `config.json`:** `oidc.discoveryUrl` replaces `oidc.issuer`. The container image writes it from the environment.
- **The audience must be one of the provider's valid audiences** (#i6nzbn1d). The client now sends it as `resource` as well as `audience`. A provider that implements RFC 8707, such as Better Auth (`validAudiences`), answers `invalid_request` for an audience it does not list.
- **git calls have a time limit** (#i3fyesqd). `--git-timeout-ms` / `NAV_SERVER_GIT_TIMEOUT_MS` / `NAVBOOK_GIT_TIMEOUT_MS` defaults to 30 s. A fetch or push that takes longer is stopped and that request fails with `SYNC_FAILED`. Set it to `0` to keep the old unlimited wait.
- **`nav pr merge` now also moves the source branch** (#en1bjq9j). See below. `--no-sync-source` keeps the old behaviour.

## Features

### A slow push no longer stalls the server (#oifeg19c)

`nav-server` used to run git synchronously. While one person's push was in flight, the process could not serve the GraphiQL page, turn away a request with a bad token, or answer a health probe. The sync engine now waits on git asynchronously while holding the lock it already had. A slow push delays only the requests queued behind it. With a push stalled for 3 s, an unauthenticated request now gets its 401 in 7 ms instead of 2.8 s. A read that needs the lock still waits for the push, by design.

- **Timeouts:** a fetch or push that hits the timeout is stopped with `SIGTERM`, then `SIGKILL` 2 s later. It is logged and reported to the client as `SYNC_FAILED`. `keptLocalCommit` tells the client whether the commit was kept locally. The next push sends it, so an operator has nothing to fix by hand.
- **In core:** `@navbook/core` gains `gitRunAsync`, `gitAsync` and `gitMaybeAsync`, a `GitTimeoutError`, and an `…Async` version of each sync operation. The async versions take the same arguments and parse git's output the same way as the blocking ones. The CLI's behaviour is unchanged.

### Stale edits are refused (#qwq7iwe9)

`updateIssue` and `updatePr` used to be last-write-wins on each field. If two people retitled the same issue, whoever saved last silently won, even if their page was rendered before the first change.

- **API:** `Issue.baseSha` and `Pr.baseSha` return the blob hash of `issue.md` / `pr.md`, and `UpdateIssueInput.baseSha` and `UpdatePrInput.baseSha` accept it back.
  - **The check:** when a hash is given, the update is refused with `STALE_CONTENT` only if a field the patch changes has changed since that version. `extensions.moved` lists those fields. A label added to an issue someone has just retitled still goes through.
  - **Optional:** when no hash is given, the update applies as before. The inbox's drag-to-rank and listing toggles send none.
  - **Unknown hashes:** a hash the clone cannot resolve counts as stale and never causes a crash.
- **Web client:** both detail pages send the hash with every field save. When an edit is refused, the page reloads the record and keeps the edit in an alert that names the changed field and what you typed. The alert offers two buttons: *Save mine over it* and *Leave theirs*.

### Every pull request field can be edited in the browser (#zhbkqxr1)

A pull request's page used to let you change only its reviewers. It now edits the title, description, labels, assignees, features and milestone in place, like the issue page. On a branch the server does not hold, every editor is disabled, not just the one that was refused. `rank` and `deadline` stay issue-only.

### `nav pr merge` fast-forwards the source branch (#k3hxjngm)

The merge record used to be committed on the target branch only. Merging `dev` into `main` left `dev` one commit behind, and `nav pr list --all-refs` showed the same pull request as `merged` on `main` and `open` on `dev`.

- **What happens now:** after recording the merge, the source branch is fast-forwarded to the target, and the CLI prints `Fast-forwarded <source> to <target>`. `MergeResult.source` in core reports the outcome.
- **When it is skipped:**
  - Silently for a remote-tracking ref or a branch that does not exist locally.
  - With a warning for a branch that has commits the target lacks, or that is checked out in another worktree.
- **Safety:** it only ever fast-forwards. It never merges, commits or produces a conflict on the source branch.
- **Flags:** `--no-sync-source` turns it off, and `--continue` performs the same step.

## Fixes

- **Web: sign-in against RFC 8707 providers** (#r5sbm79j, #i6nzbn1d). Against Better Auth and similar providers, sign-in worked but every operation was then refused. No token request asked for the API as a `resource`, so the provider issued an opaque token that `nav-server` cannot verify.
  - **Every token request now asks for it:** the authorization URL, the code exchange, and silent renewal. Renewal needed its own fix, because oidc-client-ts ignores settings on a refresh. A settings-only change would have broken again after about an hour.
  - **Array audiences:** the server now accepts a token whose `aud` is an array containing its audience. Better Auth sends that whenever `openid` is requested.
  - **Dev issuer:** it honours `resource` the same way.
- **Server and web: providers whose issuer has a path** (#kpz5ow8j, #hc9g6iog). Some providers publish their discovery document at the host root rather than under the issuer. Neither the client nor the server could find the document for such a provider; the server hit the same 404 unless the JWKS URL was spelled out. Naming the discovery document fixes both.

## Documentation and specification

- **Specs:** spec 04 documents the source-branch fast-forward and `--no-sync-source`, and spec 01 mentions it. Spec 06 §6.3 describes the stale-edit check.
- **Server README:** removes the "last-write-wins" and "git is synchronous" statements, and documents `--git-timeout-ms` and the discovery URL.
- **Web README:** separates editing a pull request's fields, which the API supports, from `nav pr update`, which appends a revision and which the API does not expose. It also covers identity-provider requirements.
- **`.env.example` and `compose.yaml`:** follow the renamed and new keys.

## Tests

- **Conformance:** new `pr-merge` fixture for `--no-sync-source`; the existing merge fixtures print the new fast-forward line.
- **Server:** new suites for responsiveness during a stalled push, stale edits, and discovery by URL. The config tests now cover both provider shapes and the rejected combinations.
- **Web:** unit tests for token requests against a stub provider, including a bare refresh, and for the stale-edit helpers. The end-to-end suite now covers editing a pull request's fields.
- **Deploy:** tests follow the renamed key.
- **Not covered end to end:** the Playwright suite was not run on #oifeg19c, #qwq7iwe9, #r5sbm79j or #kpz5ow8j, so the stale-edit alert's buttons have no end-to-end test yet.

## Before merging

- **Deployments need a new `.env` key** before running the 0.3.0 images: `NAVBOOK_OIDC_DISCOVERY_URL`, which replaces `NAVBOOK_OIDC_ISSUER` and `NAVBOOK_OIDC_JWKS_URL`. See Upgrading.
- **Publishing:** tag `v0.3.0` on `main` after the merge to trigger `release.yml`. The tag must match the core, cli and server versions, which this pull request sets.
- **Still true from 0.2.0:** the API has no authorization beyond the token, and `nav pr merge` blocks nothing. It warns when the review policy is not met, then merges anyway.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
