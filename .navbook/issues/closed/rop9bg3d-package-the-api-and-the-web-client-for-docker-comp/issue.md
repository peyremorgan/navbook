---
title: Package the API and the web client for Docker Compose
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-07T02:23:55Z
labels: [enhancement]
feature: packaging
resolution: fixed
subtasks: [d8l5m6ub]
---

Ship a two-container deployment: a `nav-server` image over a clone it seeds itself, and an nginx image serving the generated bundle, both behind an existing Traefik. Everything a deployment differs by lives in a gitignored `.env`, with a committed `.env.example` naming every key.
