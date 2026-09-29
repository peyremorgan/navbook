---
title: "plugin-tests: core seams for plugin data inside an entity directory"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:14:00Z
labels: [plugin]
assignee: Claude <noreply@anthropic.com>
parent: z9yqtsbv
---

Core changes the plugin needs: an `entityLocations` registry so files in a declared `<short>/` directory beside `pr.md` are parsed into the entity record (and fetched by the ref scan), plugin history checks run by `nav doctor` outside `--staged`, binary file writes in a Plan, a line prompt on the plugin CLI host, and `api.writeTarget` on the server plugin host.
