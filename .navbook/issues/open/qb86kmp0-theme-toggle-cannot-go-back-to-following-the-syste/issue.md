---
title: Theme toggle cannot go back to following the system scheme once pressed
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:30:20Z
labels: [bug]
feature: web
---

The navbar's theme button in the web client follows `prefers-color-scheme` only until it is pressed for the first time. From then on the browser holds `light` or `dark` in localStorage, the page stops following the system — at load and when the system scheme changes — and nothing on the page leads back to it. Pressing the button again flips between the two fixed schemes; it never returns to `system`.

Seen on a machine whose localStorage held `nuxt-color-mode` from an earlier press: the app ignored the system preference entirely, and the only way out was `localStorage.removeItem('nuxt-color-mode')` in devtools.

## What it should do

A three-way choice — light, dark, system — so that a person who once disagreed with their system can agree with it again. `system` stays the default for somebody who has chosen nothing, and whichever of the three is chosen is what gets remembered, in the browser it was made in, as the web README already describes.
