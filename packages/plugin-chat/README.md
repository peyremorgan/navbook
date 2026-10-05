# @navbook/plugin-chat

An assistant for a [Navbook](../../README.md) tracker. Ask about issues and
pull requests in your own words, and have it file, comment on, review, open
and close them. Every change is shown to you first, and happens only if you
approve it.

```console
$ nav chat -m "what is assigned to me, and is any of it overdue?"
← list_issues: 3 issues
← list_issues: 1 issue
Three issues are assigned to you; one is overdue:

| Issue | Title | Deadline |
|---|---|---|
| #bqlybac0 | Login times out on slow connections | 2026-09-12 |
```

In the web tracker, it is the round button in the lower right corner of every
page.

## What it can do

| Tool | What it does | Asks first |
|---|---|---|
| `list_issues`, `list_prs` | Search, with the same query terms `nav issue list` takes: `assignee:me`, `deadline:overdue`, `awaiting:me`, `label:bug`, free text… | no |
| `show` | Read one issue or pull request, with its latest comments and reviews | no |
| `open_issue` | File an issue | yes |
| `open_pr` | Open a pull request on a branch that carries the work | yes |
| `review_pr` | Approve, request changes, or comment as a review | yes |
| `comment` | Comment on an issue or a pull request | yes |
| `close_issue`, `reopen_issue` | Close an issue with a resolution, or reopen one | yes |

Writes go through the same operations the `nav` verbs and the API use, so they
are composed, validated and committed exactly as those are, with you as
`author:`. A pull request is written on its own branch, even when that branch
is not the one checked out.

## Setting it up

The assistant talks to any **OpenAI-compatible chat-completions endpoint** that
supports tool calling: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, or a model
running locally in Ollama, llama.cpp, vLLM or LM Studio.

Declare the plugin, and the team's choice of endpoint and model, in the
repository's `.navbook/navbook.json`:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-chat": {
      "baseUrl": "http://localhost:11434/v1",
      "model": "qwen3:8b"
    }
  }
}
```

That file is committed and shared by everyone who clones, so **the key never
goes there**. Each setting can also be given, or overridden, by the environment:

| | Command line (`nav chat`) | Server (`nav-server`) | `navbook.json` |
|---|---|---|---|
| Endpoint | `NAV_CHAT_BASE_URL` | `NAV_SERVER_CHAT_BASE_URL` | `baseUrl` |
| Model | `NAV_CHAT_MODEL`, or `--model` | `NAV_SERVER_CHAT_MODEL` | `model` |
| Key | `NAV_CHAT_API_KEY` | `NAV_SERVER_CHAT_API_KEY` | — |

The endpoint defaults to `https://api.openai.com/v1`. A local server needs no
key. With no model configured anywhere, `nav chat` says how to set one, and
the web tracker shows no assistant at all.

Anybody who can commit can change `navbook.json`, so it never decides where a
key goes either: a key is sent only to the default endpoint or to one the
environment names. With a key set and an endpoint named only in
`navbook.json`, the assistant refuses to start, and says to name that endpoint
in the environment too (or to drop the key, if it needs none).

Small local models vary a great deal in how well they call tools. A model
tuned for it — Qwen3 8B or larger, for instance — works; one that is not tends
to describe the call in prose instead of making it.

## On the command line

```
nav chat                      a conversation, in the terminal
nav chat -m <text>            one question, answered and done
nav chat -y …                 apply the changes it proposes without asking
nav chat --model <id> …       use another model for this run
nav chat --json -m <text>     one JSON event per line, for scripts
```

- **In a conversation**, type your question and press Enter. The reply streams
  as it is written. Each tool the assistant uses is one dim line on stderr, and
  a change is shown in full with `Apply? [y/N]` — under `-y` too, without the
  question. Ctrl-C at the question declines the change and stops the reply.
  - `/reset` forgets the conversation.
  - `/quit`, `/exit` or Ctrl-D leave.
  - Ctrl-C stops a reply, and leaves on an empty line.
  - Nothing is kept once you leave.
- **Piped input is part of the question**, never an answer to one:
  `git log -5 | nav chat -m "file an issue for whatever broke here"`. Since
  nobody can be asked, changes are declined unless `-y` is given — as they
  are when stdout is redirected, where the question would not be seen.
- **Every change it makes is committed**, as `--commit` would, because you
  approved that exact change. A pull request held by another branch is written
  there, in its clean worktree or a temporary one, as `nav pr comment -y` does.
- **With `--json`**, stdout carries one event per line:
  - `{"type":"text","delta":…}`
  - `{"type":"tool_call",…}`
  - `{"type":"tool_result","ok":…,"decision":…,"summary":…,"commit":…}`
  - `{"type":"done","reason":…,"usage":…}`

  Errors go to stderr and the exit code is 1.

## In the browser

The button opens a panel beside the page. Each change the assistant proposes
appears as a card saying what it will write, with **Approve** and **Decline**.
Saying something else instead declines it.

The **Edits** selector under the prompt switches to **Allow all**, which makes
the changes proposed from then on without asking, until a new conversation. A
card already waiting is still decided by its own buttons. After each change,
the lists on the page refresh and a notice names the commit, or says it could
not be pushed.

The server keeps no conversation: the browser holds it, sends it back with
each message, and loses it on reload. Each turn is one `chat` subscription,
streamed as server-sent events. The server prepends its own system prompt and
runs every tool as the signed-in person.

## What is sent where

This plugin's commands are the only part of Navbook that reach the network,
and only the endpoint configured above. What they send is:

- the system prompt: [`doc/assistant.md`](doc/assistant.md), plus who you are,
  the date, and the labels, milestones and people the tracker uses;
- the conversation;
- whatever the tools read out of the tracker while answering.

Choose an endpoint you would show the tracker to. The key is sent to that
endpoint and nowhere else, and is never logged or shown.

What the tools read was written by whoever wrote the tracker, and the model
reads it. The assistant is told to treat it as data, never as instructions,
but a model can be talked round: a pull request's description could ask it to
approve that pull request. That is what the approval is for, so think twice
before **Allow all** or `-y` in a tracker that strangers write to.

## Development

```console
$ pnpm --filter @navbook/plugin-chat test          # unit, CLI and server tests
$ pnpm --filter @navbook/plugin-chat codegen       # after changing schema.graphql or a web document
$ pnpm --filter @navbook/web test:e2e              # the browser, with this plugin's spec
```

The tests run against `test/helpers/stub-llm.ts`, a stub endpoint that answers
from a script, so none of them needs a model.
