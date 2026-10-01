---
title: "Plugin dependencies: the web build (resolver, fragment layers, plugin-defined slot nouns)"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:01:23Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
parent: f1nv9ud2
---

The web build resolves the same graph from the manifests of the layers it is told to merge.

- `webLayers()` fails the build on an unmet `depends`, a matching `breaks` or a cycle, with the server's wording. It merges base layers in resolver order, then every resolved fragment layer.
- The resolved set is in `runtimeConfig`, behind `useNavbookPlugins()`.
- Slot nouns are open: a provider registers `nouns: ["feature"]` and renders `<NavbookPanels noun="feature">`, and a dependent's fragment layer puts a panel there.
- A recipe for a dependent's `codegen.ts`.
