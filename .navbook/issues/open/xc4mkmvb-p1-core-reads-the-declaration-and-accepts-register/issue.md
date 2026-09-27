---
title: "P1: core reads the declaration and accepts registered extensions"
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:28:05Z
feature: plugins
parent: ywz73dxu
---

A pure manifest parser and version check, the plugins key read out of navbook.json the way the review policy is, and the registries core consumes: tree locations, frontmatter keys, query keys and doctor checks. Nothing loads plugin code here.
