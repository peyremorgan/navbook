---
title: "Plugin dependencies: specification and documentation"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T00:59:31Z
labels: [enhancement, plugin]
assignee: noreply@anthropic.com
feature: plugins
parent: f1nv9ud2
---

The normative text for dependencies between plugins, written before the code it governs, as the plugin system's own design was.

- **Spec 02 §2.12**, a subsection *Depending on each other*: an extension may name others it *depends on*, *recommends*, *suggests*, *conflicts with* or *breaks*, each with a version range over the other's version and a reason. A declaration should be closed under `depends`, and a tool may report it (D17). An extension validates data another extension defines only through that extension, and says nothing about it when that extension is absent.
- **Spec 04 §4.3**: load order is the resolver's, any cycle is refused naming its path, the effect of each grade on `nav`, the conditional `with` fragments and contributions to another extension's verbs (only along a declared edge), what `nav plugin install`, `remove` and `list` do with the graph, and D17 in the doctor table.
- **Spec 05 §5.2**: the five manifest keys, `with` fragments and their `./with/<short>/<part>` entries, an `activate` that returns an API, `host.plugins`, the types-only `./api` subpath, the two-phase merge, and the `engines.navbook` rule for a plugin that uses any of it.
- **`doc/plugins.md`**: the manifest reference and a *Depending on another plugin* section for both sides of an edge.
- `.navbook/specs/plugins/` records the design.

Design and the decisions behind it: the parent issue and its comments.
