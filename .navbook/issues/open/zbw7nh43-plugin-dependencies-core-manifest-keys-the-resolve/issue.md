---
title: "Plugin dependencies: core (manifest keys, the resolver, D17)"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:00:36Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
parent: f1nv9ud2
---

The format half, which every front end shares.

- `PluginManifest` gains `depends`, `recommends`, `suggests`, `conflicts` and `breaks`, each naming packages with an optional `range` over their version, a `reason`, and, under the first three, a `with` fragment that lights up only when that provider is present. `parsePluginPackage` reads and checks them.
- `resolvePluginGraph`, one pure function every host runs over the plugins it would load: a fixed point that drops a plugin whose required provider is absent, out of range or itself dropped, or that breaks a present plugin, or that sits in a cycle; a stable topological order, provider first; warnings for conflicts and for a recommended provider out of range; and every edge with its state, for `nav plugin list`.
- `host.plugins` on `CorePluginHost`: the APIs earlier plugins returned from `activate`, gated to the names a manifest declares.
- D17, *the plugins declaration is not closed under its dependencies*, from manifests alone, plus conformance cases.
- `PLUGIN_API_VERSION` moves to 1.1.0.
