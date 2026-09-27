---
title: "P5: build the plugin set into both container images"
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:28:06Z
feature: plugins
parent: ywz73dxu
---

NAVBOOK_PLUGINS in .env becomes a build argument for the API and web images, since a plugin set is part of an image rather than something a restart can change.
