---
title: Cross-plugin dependencies so plugins can require, extend and build on each other
author: Claude <noreply@anthropic.com>
created: 2026-09-30T14:15:52Z
labels: [enhancement, plugin]
feature: plugins
subtasks: [q85rhz8l, zbw7nh43, ulukw5vr]
---

Today each plugin stands alone: it contributes to the core through its
`navbook` manifest block and its `./core`, `./cli`, `./server` and `./web`
parts, but it has no sanctioned way to know about, call into, or extend another
plugin. Plugins that would naturally build on each other — a chat assistant
that can drive the knowledge base's features, test plans attached to
`plugin-kb` features, a bridge that relays another plugin's events — either
duplicate each other's logic or reach into each other's internals.

Add a mechanism for cross-plugin interaction with two kinds of dependency:

- **Required** — plugin B cannot work without plugin A. Declaring B without A
  is a fault the tooling reports (install, doctor, server start, web build),
  and B's contributions never load in a tree where A is missing or an
  incompatible version.
- **Optional** — B works on its own but lights up extra behaviour when A is
  present (extra commands, fields, GraphQL types, web panels, tools). When A is
  absent, B degrades cleanly with nothing half-loaded.

What the mechanism should give a plugin author:

- **Declaration** of dependencies in the manifest, with version ranges, so the
  host can resolve them from metadata alone without importing plugin code —
  keeping the "contributions are declared, not discovered" and lazy-loading
  rules intact.
- **A way to expose and consume a surface** between plugins, e.g. a plugin
  publishing an API or extension points that dependents use, rather than
  importing each other's private modules.
- **Deterministic load order** across all four parts (format, CLI, server, web),
  with cycles detected and reported.
- **Format consistency**: a dependent that stores data alongside another
  plugin's namespace must keep the tree valid and doctor-clean when either is
  removed.

It should also respect the existing trust model: the repository's `plugins`
declaration is data, not instruction, so resolving a dependency MUST NOT fetch
or execute anything on its own — `nav plugin install` should show what the
dependency graph adds and ask, as it does for direct plugins.

Open questions for the research and planning phase: whether dependencies live in
`navbook.json`, the plugin manifest, npm `peerDependencies`, or a mix; how
optional integrations are discovered at each layer (CLI, server, web layer
merge); how versions of a plugin-to-plugin API are negotiated; and which
specification sections (format, CLI, doctor checks) change.
