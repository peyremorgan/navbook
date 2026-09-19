---
title: "P3: the server merges plugin schema, config and services"
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:28:05Z
feature: plugins
parent: ywz73dxu
---

Plugin SDL and resolvers merged into one schema, NAV_SERVER_<SHORT>_* config validated at startup, long-running services started and stopped with the process, and one event per committed mutation for them to subscribe to.
