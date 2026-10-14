---
title: Parsing a frontmatter with a large nested map is quadratic
author: Claude <noreply@anthropic.com>
created: 2026-10-14T08:57:15Z
labels: [bug, performance]
assignee: Claude <noreply@anthropic.com>
---

Found by the 0.7.0 release review of plugin-poll.

Frontmatter that core's fast reader cannot take (anything nested) goes through the `yaml` package's `parseDocument`, whose duplicate-key check is quadratic in the number of keys of one map. Measured with `parseFile` on Node 24:

| keys in one nested map | parse |
|---|---|
| 2,500 | 330 ms |
| 5,000 | 1.2 s |
| 10,000 | 5.6 s |

Flat frontmatter is unaffected (20,000 top-level keys: 51 ms, through the fast reader).

No writer produces such a map: the poll API caps a ballot at 50 answers since the release review. It takes a hand-crafted file pushed to the tracker, which every server reading the tree then parses on each tree load. Present since the first release; not a 0.7.0 regression.

Options: refuse or skip a frontmatter block above a size or key-count bound before handing it to `yaml`, or check `uniqueKeys: false` and detect duplicates ourselves in linear time.
