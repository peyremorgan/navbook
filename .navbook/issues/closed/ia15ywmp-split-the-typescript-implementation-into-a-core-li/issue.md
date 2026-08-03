---
title: Split the typescript implementation into a core lib and a CLI frontend
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-03T09:30:57Z
resolution: fixed
---
This is preliminary work before starting the implementation of the web client. The target is to have a CLI tool and a GraphQL API backed by a shared TS implementation. The first step (this ticket) is to split the logic core into a dedicated lib that the CLI imports. Both will live inside this repo.
