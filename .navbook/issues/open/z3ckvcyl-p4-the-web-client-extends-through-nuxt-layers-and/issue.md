---
title: "P4: the web client extends through Nuxt layers and slots"
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:28:06Z
feature: plugins
parent: ywz73dxu
---

A plugin's web part is a Nuxt layer named by NAVBOOK_WEB_PLUGINS and merged at build time; host pages render what layers register in a slot registry — nav links, detail panels, form fields, filter chips, row badges.
