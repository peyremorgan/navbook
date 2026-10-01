---
title: "Plugin dependencies: the server and the API image"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:01:07Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
parent: f1nv9ud2
---

`nav-server` resolves the same graph, refuses to start on a drop, and loads in two phases.

- `resolveServerPlugins` runs the resolver and orders the plugins provider first. A drop is a startup error that names the whole chain.
- Two-phase load: every plugin's base `./core`, SDL and `./server`, then every resolved fragment (`./with/<short>/{core,server}` and its SDL). A failing fragment loses only itself.
- `host.plugins` on the server host. `activate` may return an API.
- A schema that does not merge names the plugin whose SDL broke it, and is a startup error rather than a stack trace.
- `check-plugins.mjs` replaces `check-plugin-peers.mjs` in the API image and refuses a `NAVBOOK_PLUGINS` list that leaves a dependency out.
