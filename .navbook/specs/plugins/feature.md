---
title: Plugins
author: Claude <noreply@anthropic.com>
created: 2026-09-19T09:27:36Z
---

A plugin system so optional features — test reports, an AI ticket assistant, chat bridges, the knowledge base — ship outside the core. A plugin is an npm package; the repository declares which it uses in navbook.json; each machine installs them explicitly. A declarative manifest in the package's `navbook` key turns one plugin into CLI subcommands, GraphQL schema and web UI.
