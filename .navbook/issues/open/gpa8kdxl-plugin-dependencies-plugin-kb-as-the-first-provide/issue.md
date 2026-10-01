---
title: "Plugin dependencies: plugin-kb as the first provider"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:01:35Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
parent: f1nv9ud2
---

The knowledge base publishes a surface that other plugins can build on, which #l2xyp1u5 needs.

- A types-only `./api` subpath, and `./core` and `./server` `activate` return `KbCoreApi` and `KbServerApi`: the features, one feature, and its members.
- The feature page renders panels for the `feature` noun.
- `nav feature show` prints the sections other plugins contribute to it.
