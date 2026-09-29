---
title: "plugin-tests: attach test plans to features"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:14:04Z
labels: [enhancement, plugin]
---

Deferred from #z9yqtsbv. Let a plan carry the `feature:` key and have `nav feature show` and the feature page list a feature's plans. Needs a seam between plugin-kb and other plugins (a contribution hook on `feature show` and a `feature` panel noun), which is why it was left out of the first version.
