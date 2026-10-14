---
title: "@navbook/plugin-discord: a Discord bridge for pull requests and issues"
author: Claude <noreply@anthropic.com>
created: 2026-10-14T01:35:38Z
target: dev
source: feat/plugin-discord
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 9dae9ebaf7073685573007db711a775991689e88
    base: 9f82073e48e1466079fcfaa1b25059fbdfad802e
    date: 2026-10-14T01:35:38Z
---

The second of two pull requests for #xsd6wgvi, and the one that closes it: `@navbook/plugin-discord`, a bridge between the tracker and a Discord server. It runs as a service inside `nav-server`, on the seams #vm2byi9o added.

## What it does

- **Threads.** Every pull request gets a thread in the channel `prs` names. An issue gets one when a rule in `issues` fires: on being opened, assigned, closed or reopened, or on gaining a frontmatter field or one of its values, when it is in the rule's scope (all issues, or root issues only) and matches the rule's query. A forum channel makes each thread a post, with status and label tags. A text channel holds a card, and the thread hangs from it.
- **What a thread is told.** The card is redrawn as the record changes. Below it, one message per event: comments and reviews, status changes, assignments and review requests (which ping a linked account), new revisions, and changes to a field a rule watches. Closing or merging archives the thread, reopening brings it back, and a retitle renames it within Discord's limit. The bridge compares record states after every sync, so a change pushed from a terminal is told as one made over the API is.
- **Acting from Discord.** `/nav link | unlink | whoami | comment | review | assign | close | reopen | show | thread`, card buttons, and a message menu entry that turns a message into a comment. Each runs through `host.api.execute` as the linked person, never as the bot. An approval from a card is bound to the revision that card showed.
- **Linking.** `/nav link` hands out a one-time code. The web page `/discord/link` redeems it while signed in and commits the mapping to the plugin's settings block. `nav discord link | unlink | people` is the path for admins and for offline use.
- **Web.** The link page, a panel on issue and PR pages, and a row badge, both of which lead to the record's thread.
- **No runtime dependencies.** REST over `fetch`, with per-route rate-limit buckets, and the gateway on Node's global `WebSocket`, with heartbeat, resume, and fatal close codes that stop rather than loop.

The settings live in the plugin's block of `navbook.json`, and the secrets (token, application id, a guild pin, the API base) in `NAV_SERVER_DISCORD_*`. Without a token, the bridge is not offered and says so once. What the bridge keeps between runs is a disposable file in the clone's git directory. Lost, the bridge starts from the tracker as it is and replays nothing.

The first-party plugin lists all name it: Dockerfiles, compose, `.env.example`, release, the web scripts, dev-stack and the docs.

## Review

The last two commits fix what `/code-review high` found, once before the rebase onto #vm2byi9o and once after it:

- A thread whose creation Discord did not confirm is looked for before another is made.
- A deleted card no longer makes the bridge forget its thread.
- Refused renames and unusable channels are no longer retried for ever.
- A gateway resume address that cannot be reached is given up for a new session.
- A thread a rule opens for a settled record is archived.
- State saves are bounded.
- Ids and people go through core's own parsers.

The rebase also adapted one test to PR1's generic refusal message: the server now logs which rule refused whom, and the bridge logs which Discord account asked.

## Testing

- `packages/plugin-discord`: 97 tests, no network. They run against a stub Discord (REST, plus a gateway on a hand-written RFC 6455 server) and real `nav-server` harnesses. They cover the REST client's buckets, 429s and token scrubbing; the gateway's identify, resume, invalid sessions and fatal closes; the settings, rules, events and rendering; threads opened, told, renamed and archived, from API writes and from peers' pushes; restarts with and without state; every command, linked and unlinked; stale-revision approvals; refusals; and every review finding. Each new test was checked to fail without its fix.
- End to end, with the bundle built with all five layers: 206 Playwright tests pass. The bridge's own three cover linking through the web page, keeping a code through sign-in, and leading from a row and a page to the thread.
- Every other suite passes on the branch: server 537, kb 145, tests 120, chat 149, poll 109, web vitest 440, deploy 84. Codegen is unchanged, `nuxi typecheck`, `tsc` and biome are clean, and `nav doctor` shows 0 errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
