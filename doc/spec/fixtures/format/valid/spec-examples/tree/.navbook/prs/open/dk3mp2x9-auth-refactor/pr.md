---
title: Refactor auth token handling
author: ked@example.com
created: 2026-08-04T16:40:00Z
target: main
source: feat/auth-refactor
reviewer: alice@example.com
revisions:
  - head: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d
    base: 91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0
    date: 2026-08-04T16:40:00Z
---

Replaces the ad-hoc token cache with per-session storage.
Closes: bqlybac0
