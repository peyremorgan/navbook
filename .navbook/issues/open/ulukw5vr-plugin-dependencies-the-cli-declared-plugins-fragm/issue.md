---
title: "Plugin dependencies: the CLI (declared plugins, fragments, contributions to plugin verbs, nav plugin)"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:00:51Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
parent: f1nv9ud2
---

`nav` runs the resolver and honours what it decides.

- The CLI loads what the repository declares, plus `NAVBOOK_PLUGIN_PATH`, as the server already does. An installed but undeclared plugin is inert, and `nav plugin list` says so.
- `NAVBOOK_PLUGIN_PATH` is split on the platform's path delimiter, so a Windows path survives.
- Conditional fragments: a fragment's commands, options, query terms and checks appear only when its provider resolved, and its `./with/<short>/<part>` entries load only then, under the same lazy rule.
- `host.plugins` and `host.contributions(path)`. Contributions may target any command, including another plugin's verbs, along a declared edge.
- `nav plugin install` installs a plugin's required dependencies in rounds, asks about recommended ones separately, and warns about `breaks`. `remove` names the plugins it will leave without a provider. `list` shows each edge and its state, and `--json` carries the graph.
- Doctor reports D17.
