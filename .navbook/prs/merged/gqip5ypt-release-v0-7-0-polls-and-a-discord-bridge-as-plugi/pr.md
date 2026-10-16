---
title: "Release v0.7.0: polls and a Discord bridge, as plugins; services in the server; sparse write worktrees"
author: Claude <noreply@anthropic.com>
created: 2026-10-14T09:53:48Z
target: main
source: dev
reviewer: morgan.peyre@brickcode.tech
labels: [release]
revisions:
  - head: c6ef644841f7571ec460cd8f4612e57dcaf75942
    base: b1c88dc52f49706b728d87c82af0d3b8defa5758
    date: 2026-10-14T09:53:48Z
merged:
  date: 2026-10-16T05:07:07Z
  by: Claude <noreply@anthropic.com>
---

Releases v0.7.0: everything on `dev` since v0.6.1, the version bump, and the fixes from this release's adversarial review.

That is 95 commits. 44 of them are tracker bookkeeping and 8 are merges. Of the other 43, 39 change code, tests or packaging, and 4 change only documentation and specification. Together they touch 187 files outside `.navbook/`. Seven pull requests merged into `dev` in that time: #p4jj02ne, #nh75ce1c and #z0qt8gpt (polls), #a33qi8vi (sparse write worktrees), #nhzigv8s (a maintenance test), #vm2byi9o (service seams) and #bnwy556c (the Discord bridge). `chore(release): 0.7.0` (0f5229d) sets every `package.json` to 0.7.0, and moves the five plugins' `@navbook/core` peer range, the `doc/plugins.md` example and the README's `nav plugin list` example with it. The review's fixes were merged on top of it (c6ef644), and are listed under Fixes.

# Release notes — v0.7.0

Two new first-party plugins. `@navbook/plugin-poll` puts polls on issues: questions with options, a ballot per person that their next one replaces, and the decision each question came to once somebody closes it. It is how a team settles a design, and how an agent planning a change asks a person to choose. `@navbook/plugin-discord` bridges the tracker to a Discord server: a thread per pull request and per issue a rule picks, events told as they happen (from the API or pushed from a terminal), and slash commands and buttons that act as the person who used them. The server's plugin host gains what the bridge needed to run as a service. Worktrees Navbook makes for a write now check out only the tracker.

Published: `@navbook/core`, `@navbook/cli`, `@navbook/server`, `@navbook/plugin-kb`, `@navbook/plugin-tests`, `@navbook/plugin-chat` and, new to npm in this release, `@navbook/plugin-poll` and `@navbook/plugin-discord`, all at 0.7.0. `@navbook/web` ships in its container image only.

## Upgrading

- **Plugins' `@navbook/core` peer range is `^0.7.0`.** Install the 0.7.0 plugins with the 0.7.0 CLI and server: `nav plugin update`.
- **Plugin API 1.2.0** (#vm2byi9o). Plugins written for 1.0 or 1.1 keep loading. `@navbook/plugin-discord` needs 1.2.
- **Write worktrees are sparse** (#a33qi8vi). The server's write site and the CLI's `-y` temporary worktree on a pull request's branch now check out the Navbook directory and the top-level files only. A repository that needs the whole tree there (a hook that reads source files, say) sets `"worktrees": { "sparse": false }` in `.navbook/navbook.json`. A malformed value is a D15 error and reads as the default. A worktree that already has the branch is used as it is.
- **Deployments.** `NAVBOOK_PLUGINS` may now also name `@navbook/plugin-poll` and `@navbook/plugin-discord`; both images carry them. The bridge reads `NAVBOOK_DISCORD_TOKEN` (and, recommended, `NAVBOOK_DISCORD_GUILD`, which pins the guild against a committed change of settings) from `.env`; without a token the server runs no bridge and says so once. Its channels and rules are in the plugin's block of `navbook.json`.
- **Discord links on a server with token-only admission rules.** With `--require-claim` or `--require-email-verified`, which a service cannot check without a person's token, linked Discord accounts act for nobody, and the log says so at start. `NAVBOOK_DISCORD_TRUST_LINKS` (`NAV_SERVER_DISCORD_TRUST_LINKS`) says the operator accepts that a link outlives a revoked claim; offboarding is then `nav discord unlink <address> --commit` and a push.
- **New API error code `UNAVAILABLE`**, for an operation a plugin service asks of the clone after shutdown has stopped services. No client request can meet it.
- **Web plugin defaults.** The web package's scripts now default `NAVBOOK_WEB_PLUGINS` to all five first-party plugins.

## Features

### Polls on issues (`@navbook/plugin-poll`, #gel4fvdo: #p4jj02ne, #nh75ce1c, #z0qt8gpt)

- **The format** (`packages/plugin-poll/doc/spec.md`): `poll/<id>-<slug>/poll.md` inside an issue's directory, with each vote a comment-named file beside it, so two people voting at once never conflict. A question is single- or multiple-choice, an option a label with an optional Markdown description, and a question may accept a write-in. A vote is a whole ballot with an optional note; a person's latest one counts, and an empty one withdraws. Every vote records a fingerprint of the questions it answered, so changing the questions revokes every ballot cast before. Tallies, leaders and decisions are derived, never stored. Checks X-poll-1 to 3.
- **CLI:** `nav poll open|vote|show|list|edit|close|reopen`, `--json` throughout. `vote` works by flags over your last ballot or question by question at a terminal. `close` records the leader unless you decide otherwise, and refuses to break a tie for you. `nav issue show` lists an issue's polls; `poll:` and `poll-awaiting:` query terms.
- **API:** `Poll`, `Query.poll`, `Issue.polls`, five mutations acting as the signed-in person, `myState`/`myDraft`, `polls` and `pollAwaiting` issue filters, `ext.poll` on rows.
- **Web:** each poll is a card in its issue's discussion where it was asked, with results hidden until you vote unless the poll says otherwise; a polls panel with **New poll**; a row badge, a `poll` filter chip, and **Polls awaiting me** in the inbox.
- **For agents:** the plugin's README shows an agent opening a poll to ask for a decision, and reading the outcome back with `nav poll show --json`.

### A Discord bridge (`@navbook/plugin-discord`, #xsd6wgvi: #bnwy556c)

- **Threads:** every pull request gets one; an issue gets one when a rule in the settings fires (opened, assigned, closed, reopened, a field or value gained), scoped and filtered by a query. Forum channels get posts with status and label tags; text channels a card with the thread under it.
- **What a thread is told:** the card is redrawn as the record changes; comments, reviews, status changes, assignments and review requests (pinging linked accounts), revisions and watched field changes are posted. Closing or merging archives the thread. Changes pushed from a terminal are told like those made over the API.
- **Acting from Discord:** `/nav link | unlink | whoami | comment | review | assign | close | reopen | show | thread`, card buttons, and a message menu entry that turns a message into a comment, each run as the linked person, never as the bot. An approval from a card is bound to the revision the card showed.
- **Linking:** `/nav link` gives a one-time code redeemed on the web page `/discord/link`; `nav discord link | unlink | people` for admins.
- **No runtime dependencies:** REST over `fetch` with per-route rate-limit buckets, and the gateway over Node's `WebSocket`.

### Plugin host seams for services (#vm2byi9o)

`host.onSync(listener)` (told after every pull that fetched and every write, outside the lock), `host.api.contextFor(person?)` (the context that person's request would have had, under the same admission rules), a ten-second shutdown deadline for services, and `core.listRefShasAsync`. Plugin API 1.2.0. `doc/plugins.md` and the server README document them.

### Two new web slots (#z0qt8gpt)

`timelineItems` places a plugin's things in an issue's discussion, by time among the top-level comments; `inboxSources` adds a reason to be in the inbox, asked with the host's own row fragment. A source that fails takes only its own rows out of the inbox. Both are in `doc/plugins.md`.

### Sparse write worktrees (#h45qu2fx: #a33qi8vi)

Described under Upgrading. A commit, fast-forward, merge or abort made there never touches out-of-cone paths; a hooks directory inside the tree is kept in the cone; it falls back to a full checkout where a path cannot be a cone pattern. Spec 02 §2.10 defines the `worktrees` key, with two conformance fixtures.

## Fixes

- **The server's maintenance test with git 2.56** (#s9qwm9vd: #nhzigv8s). Git 2.56 raised `--auto`'s repack threshold, so the test's 3000 loose objects no longer triggered it. The test now sets its own threshold and reads no machine git config. The server is unchanged.
- **Found in the release review** (`fix/release-0.7.0-review`, merged into `dev` before this pull request's last revision). Four adversarial reviewers attacked plugin-poll, plugin-discord, the host changes and the packaging at `0f5229d1`; a fifth reviewed the fixes themselves, and its findings were fixed too. No blocker remains.
  - **plugin-poll:**
    - *Blocker:* reading a vote was quadratic in its picks and nothing bounded a poll, so one signed-in user could open a 20,000-option poll, vote for all of it, and make every later tree read take 11–17 s. Reading is now linear, and the spec sets limits (§4.2: 50 questions, 100 options, lengths of every text), enforced by every writer and reported by `doctor` on a hand-written file; refusals list at most 20 faults.
    - A far-future vote file no longer decides when a poll closes; a close ignores votes stamped more than five minutes ahead (X-poll-2 warns of them), and proposes its decision from the ballots it will count. A voter's votes still sort in the order they were cast.
    - A vote's unknown `status:` key is preserved rather than a fault; the spec names the exact whitespace and line-break characters; votes in a poll directory without `poll.md` are checked; a question with ID `constructor` no longer confuses the web form; trailing-whitespace trims are linear.
  - **plugin-discord:**
    - On a server with `--require-claim` or `--require-email-verified`, which cannot be checked without a token, linked accounts now act for nobody unless the new `NAVBOOK_DISCORD_TRUST_LINKS` says otherwise. Offboarding is `nav discord unlink`.
    - A link to an address the settings would refuse is refused before the code is spent, and a bad `people` entry is dropped and reported rather than stopping the server.
    - Threads are found again only if the bot made them, in the served guild, so the guild pin cannot be bypassed on a start without state.
    - `/nav show`, its completion and every command's refusals need a linked account, so an unlinked member learns no ids or titles.
    - A revoked token (401) no longer drops events or loops the gateway; interaction tokens are redacted from logged errors; close → reopen → close is told three times.
  - **Server:**
    - It now installs its SIGTERM handlers before announcing that it listens. An orchestrator stopping it right after readiness used to kill it without a graceful stop.
    - Plugin services are stopped together within the ten-second deadline, so one hung service no longer starves the others. No sync listener runs after its service stopped. Once services are stopped the clone refuses new operations (`UNAVAILABLE`), and `drain()` waits for everything queued.
  - **Web:** registered inbox and timeline keys are read as own properties; a plugin's broken timeline slot no longer blanks the discussion.
  - **Core:** `normalizeBody` trimmed a body with `/\s+$/`, which takes ten seconds over 100,000 spaces before a last word, under the server's write lock on every API write. It now uses `trimEnd`. Present since the first release.
  - **Release:** each publish step skips a version the registry already has, so a run that stops partway (for instance on a token that may not create the two packages new to npm) can be re-run. Two docs that drifted are fixed.

## Tests

On a fresh clone of `648d2e68` (the review fixes' head, the same tree as this pull request's head bar one tracker commit), the steps of `release.yml` short of publishing, with Node 24.21, pnpm 11.18.0, `GITHUB_REF_NAME=v0.7.0` and `TMPDIR` unset as on Ubuntu:

| Step | Result |
|---|---|
| tag check: all eight packages at 0.7.0 | passed |
| frozen install, `pnpm check`, `codegen:check` | passed |
| core / server / cli | 991 / 545 / 440 passed |
| plugin-kb / -tests / -chat / -poll / -discord | 145 / 120 / 149 / 130 / 108 passed |
| web unit | 445 passed |
| conformance from source, and against the built CLI | 130/130 each |
| deploy | 80 passed |
| `pnpm build`, and eight tarballs packed at 0.7.0 | passed |
| consumer smoke test | passed: `nav --version` is 0.7.0; all five plugins install from their tarballs; `feature`, `test`, `chat` (refusing without a model), `poll open`/`list`, `discord people` and `doctor` run; `nav-server --help` resolves |

Playwright, with the bundle built with all five layers: 206/206.

The same replay at `0f5229d` (the bump, before the review) passed too. A second replay, at the first round of fixes, failed one new server test under load; that exposed the signal-handler race fixed above, and the run at `648d2e68` is the one after it.

The packaging reviewer also installed the tarballs as a consumer would, ran the server from them with all five plugins loaded, and loaded the 0.7.0 kb, tests, chat and poll plugins into a 0.6.1 `nav` (API 1.1): they work, and discord, which needs API 1.2, is skipped with a message.

## Known, not fixed

- **#s9p3gp7b:** parsing a frontmatter with a large nested map is quadratic (10,000 keys: 5.6 s), in the `yaml` package's duplicate-key check. No writer produces one; it takes a hand-crafted file. Present since the first release.
- A plain `npm install` of a plugin beside `nav-server` needs `--legacy-peer-deps` (documented now in the server README); the image and `nav plugin install` already pass it.
- At shutdown, if git maintenance runs out its time, its clean-up can now be refused after the clone closed, leaving its leftover files for the next start to clear. Very unlikely.
- Sparse write worktrees mean a pre-commit hook that reads source files sees none there. Documented, with the `sparse: false` opt-out.

## Before merging

- **First publishes.** `@navbook/plugin-poll` and `@navbook/plugin-discord` are new to npm. Check that `NPM_TOKEN` may create packages in the `@navbook` scope; a granular token limited to the six existing packages cannot. If it fails anyway, the publish steps now skip what is already on the registry, so the job can be re-run once the token is fixed.
- **Pushing.** Local `main` was fast-forwarded to `origin/main` (v0.6.1, `b1c88dc`). `dev` is 95 commits ahead of `origin/dev`. With no merge method declared, `nav pr merge` fast-forwards `main` to `dev`. Then tag `v0.7.0` on `main`, and push `main`, `dev` and the tag; the tag runs `release.yml`.
- **Deploying the tracker.** This repository declares only plugin-kb; adding the others to `NAVBOOK_PLUGINS` is optional. Discord needs `NAVBOOK_DISCORD_TOKEN` and settings in `navbook.json`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
