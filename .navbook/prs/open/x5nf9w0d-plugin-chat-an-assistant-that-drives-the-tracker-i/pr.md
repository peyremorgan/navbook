---
title: "plugin-chat: an assistant that drives the tracker in natural language"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T03:23:13Z
target: dev
source: feat/s86nic83-plugin-chat
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 658f14412f000e329811b757c4d1f067462562d5
    base: d576c77713d71b04f266bde7b9b50718df4af151
    date: 2026-09-29T03:23:13Z
  - head: b3a98115a3a461edba7ca0101d744fb06cb3383b
    base: d576c77713d71b04f266bde7b9b50718df4af151
    date: 2026-09-29T03:24:08Z
---

Closes #s86nic83, the third of three steps towards #c43a2w7e.

**Stacked on `#g3xqbgn5`**, which is stacked on `#lfr46mfi`: merge those first, then rebase this onto `dev`.

A new plugin, `@navbook/plugin-chat` (short `chat`). A person asks about issues and pull requests in their own words ("what is assigned to me?", "show me the overdue issues"), and the assistant files, comments on, reviews, opens and closes them once the person approves each change.

## Engine (`src/shared`), no runtime dependencies

- **Client:** OpenAI-compatible chat completions, streamed over `fetch` with a shared SSE parser. It tolerates the ways servers really stream:
  - a tool-call delta with no index;
  - a name repeated in full or sent empty on continuation deltas;
  - arguments sent as an object (llama.cpp);
  - usage arriving in a chunk with no choices.

  `tool_choice` is never sent, since Ollama refuses it. Errors come back as words for a person: bad key, wrong URL or model, rate limit, nothing listening, timeout. The key is scrubbed from every message.
- **Tools:** `list_issues`, `list_prs`, `show`, `open_issue`, `open_pr`, `review_pr`, `comment`, `close_issue`, `reopen_issue`.
  - Schemas are flat JSON Schema that every OpenAI-compatible server accepts.
  - Every call is checked against its schema, plus semantic checks, before it runs. A bad call goes back to the model as something to fix.
  - `me` stands for the person asking.
- **Runner:** reads run at once. Each write asks, and the answer is `approved`, `denied` or `defer`; a deferred write stays pending in the transcript for the next turn. After eight tool rounds, tools are withdrawn. Every call gets a tool message, and an interrupted turn adds nothing half-written.
- **Reads:** the same core query as `nav issue list`, run the same way by the CLI and the server. `list_prs` merges the working tree (every status) with the branch scan (open PRs anywhere).
- **Prompt:** `doc/assistant.md`, written for the model (~7 KB), followed by the session: viewer, date, branch, labels, milestones, people, and plugin query terms. The fixed text comes first for provider caching.

## `nav chat`

- A minimal line REPL:
  - the reply streams;
  - each tool is one dim line on stderr;
  - a write is shown in full, then `Apply? [y/N]`;
  - `/help`, `/reset`, `/quit` and Ctrl-D;
  - Ctrl-C stops a reply, and leaves on an empty line.
- `-m` for one question; piped stdin is part of the question.
- `-y` applies changes without asking. `--json` emits NDJSON events, and without `-y` it declines writes.
- Approved writes are committed. A PR held by another branch is written there through `ui.withPrWriteSite` / `ui.withBranchWriteSite`.
- Config: `NAV_CHAT_*` env, `--model`, or `navbook.json` settings. The key comes from the environment only.

## Server

- **`Query.chat`** returns `{ model, endpoint (origin only), tools }`, or null with no model.
- **`Subscription.chat`**, stateless over SSE:
  - The client sends the transcript as an opaque string (the host's `JSON` scalar is output-only), plus a message, approvals and `autoApprove`.
  - The client-sent transcript is validated: shape, size, no system messages, tool answers matching real calls.
  - A new message over pending writes runs the approved ones and declines the rest.
  - Reads run through core inside `sync.read`; writes run through `host.api.execute` against the host's own mutations.
  - A browser disconnect aborts the model call (`ctx.request.signal`; the test was mutation-checked).
  - Model failures arrive as `ERROR` events carrying the transcript.

## Web

- A round button in the lower right, through the new `overlays` slot, opens a `USlideover` built from Nuxt UI's chat components, with no `ai` dependency.
- Replies render through the host's `MarkdownBody`, so `#id` references are links.
- Each write is an approval card with Approve / Decline. With several waiting, a decided card says so.
- The **Edits** selector (Manual / Allow all) sits under the prompt.
- After a commit, listings and detail queries are evicted and the commit toast shows.
- The button is hidden when `chat` is null or the server lacks the plugin.
- Checked visually in light, dark and at 390 px.

## Deploy

Both Dockerfiles copy and pack the package, and compose maps `NAVBOOK_CHAT_{BASE_URL,MODEL,API_KEY}` to `NAV_SERVER_CHAT_*` (documented in `.env.example`). The API image additionally needs #uniyh2hy's fix and `--filter "@navbook/plugin-chat..."`; see the comment there.

## Tests

| Suite | Result |
|---|---|
| plugin-chat | 134 passed |
| core | 896 passed |
| server | 469 passed |
| cli | 411 passed |
| plugin-kb | 138 passed |
| conformance | 128 passed |
| deploy | 73 passed |
| web vitest | 411 passed |
| Playwright | 180 passed |

What the plugin-chat suite covers:
- **Unit:** SSE fixtures and accumulation quirks; the client against a stub and failure modes; tool schemas and every validator refusal; config precedence; prompt; transcript validation; runner flows; the REPL through a fake terminal; the web reducer.
- **CLI, through the real `nav`:**
  - one-shot mode, configuration from env and from `navbook.json`, piped stdin;
  - `-y` filing, and denial without `-y`;
  - `assignee:me`, `deadline:overdue`, `show` of a missing ref;
  - close/reopen, a review on another branch, `open_pr --source`;
  - `--json`, 401, nothing listening;
  - an import hook proving `nav issue list` loads none of the plugin.
- **Server, through `nav-server`:** streaming, approve/decline/move-on, Allow all, a refused write's code, `open_pr` + `review_pr` on a pushed branch, disconnect, 401, model failure, input refusals, unconfigured.
- **Playwright, 9 cases:** hidden without the plugin; open; streamed Markdown; approve → toast → listing; decline; two cards; Allow all; failure and reset; absent on signed-out pages.
- **Manual:** the REPL in a real PTY via Python `pty`: streaming, approval, Ctrl-C on a reply and on a line, `/help`, Ctrl-D exit 0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
