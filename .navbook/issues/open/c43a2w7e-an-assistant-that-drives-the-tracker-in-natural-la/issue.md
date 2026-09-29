---
title: An assistant that drives the tracker in natural language (plugin-chat)
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:23:09Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
---

A new plugin, `@navbook/plugin-chat` (short `chat`), that lets a person drive the tracker through an LLM: "are there open issues assigned to me?", "show me the overdue issues", "file an issue for …", "approve this pull request".

- **CLI:** `nav chat` is a minimal line REPL; `nav chat -m <text>` answers once. `-y` applies proposed changes without asking, `--model` overrides the model, `--json` emits one event per line. Piped stdin is part of the message.
- **Web:** a floating button in the lower right opens a slideover chat. An "Edits" selector under the prompt picks `Manual` (every write asks for approval) or `Allow all`.
- **Provider:** any OpenAI-compatible chat-completions endpoint (OpenAI, Ollama, llama.cpp, vLLM, LM Studio, OpenRouter, …). Raw `fetch` with streaming, no runtime dependencies. Configuration: `baseUrl` and `model` under the plugin in `navbook.json` (shared), overridden by `NAV_CHAT_*` (CLI) or `NAV_SERVER_CHAT_*` (server) environment variables; the API key only ever comes from the environment.
- **Tools:** `list_issues`, `list_prs`, `show`, `open_issue`, `open_pr`, `review_pr`, `comment`, `close_issue`, `reopen`. Reads run at once; every write pauses for approval.
- **System prompt:** a curated `doc/assistant.md` written for the model, embedded in the package.

Two host gaps have to close first, so the work lands in three pull requests, tracked as subtasks.
