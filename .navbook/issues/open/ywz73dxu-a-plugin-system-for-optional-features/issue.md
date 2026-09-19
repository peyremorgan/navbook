---
title: A plugin system for optional features
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:27:49Z
labels: [enhancement]
feature: plugins
subtasks: [pr9o3vcf, xc4mkmvb]
---

Optional features that not every project wants — test reports attached to pull
requests, an AI assistant that helps write tickets, bridges to Discord, Slack
and Matrix, and the knowledge base that is built in today as \`nav feature\` and
\`specs/\` — should ship as plugins rather than swell the core.

The design, decided in full before implementation:

- **Identity** is the full npm package name: \`@navbook/plugin-<name>\`,
  \`navbook-plugin-<name>\` or \`@scope/navbook-plugin-<name>\`, with
  \`navbook-plugin\` among its keywords.
- **The repository declares, the machine installs.** \`navbook.json\` gains a
  \`plugins\` key naming the packages the tree uses, so every clone, the doctor,
  the server and the web agree on what the format contains. Nothing is fetched
  or executed because a file names it: \`nav plugin install\` reads the
  declaration, prints what it would install, and asks.
- **Contributions are declared, not discovered.** A \`navbook\` block in the
  plugin's package.json says what it adds; the host builds commands, help and
  completions from that alone, and imports the plugin's code only when one of
  its contributions actually runs.
- **One package, four parts**, as \`exports\` subpaths: \`./core\` (format),
  \`./cli\`, \`./server\` (GraphQL and long-running services) and \`./web\` (a Nuxt
  layer merged at build time).

Subtasks carry the phases.
