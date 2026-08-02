---
title: A revision whose SHA is all digits
author: ked@example.com
created: 2026-08-04T16:40:00Z
target: main
source: feat/digits
revisions:
  - head: 4444444444444444444444444444444444444444
    base: 91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0
    date: 2026-08-04T16:40:00Z
---

YAML resolves an all-digit SHA to a number; implementations must still read
back the forty characters the author wrote.
