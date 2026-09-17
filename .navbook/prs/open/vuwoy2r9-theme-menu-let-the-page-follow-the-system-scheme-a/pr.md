---
title: "Theme menu: let the page follow the system scheme again"
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:34:18Z
target: dev
source: fix/qb86kmp0-theme-system-preference
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: web
revisions:
  - head: 4a20cd14222978671945571b26894091cb91ae70
    base: 908e234c92b3ae7eddb8dc9c5588f25c1455e588
    date: 2026-09-17T17:34:18Z
---

Fixes #qb86kmp0. The navbar's theme control could say light or dark but never system, so the first press stopped the page following `prefers-color-scheme` for good.

## Change

- `ThemeMenu.vue` replaces `UColorModeButton`. The menu has System, Light and Dark, with the current preference ticked. The button's icon shows the preference: a monitor, sun or moon. Its `aria-label` is `Theme: system (dark)`, `Theme: light` and so on. The `theme-toggle` test ID moves to that button.
- `app/utils/theme.ts` holds the preferences and builds the menu. Entries use `onSelect` rather than `onUpdateChecked`: picking the entry that is already ticked would otherwise report `false`, and there's no such thing as having no preference.
- Choosing System stores `system`. Under that value, `@nuxtjs/color-mode`'s head script reads the scheme at load, and its client plugin follows the scheme when it changes. Neither module was touched.
- I chose a menu over a button that steps system → light → dark. When the system already matches one of the fixed schemes, stepping spends two presses in a row with no visible change, and it never says which of the three is in force.
- The web README's "Dark or light" paragraph and the layout comment are updated to match.

## Tests

- `test/nuxt/theme.test.ts` (unit): System is offered, exactly the current entry is ticked, you can go back to system from a fixed choice, and re-choosing the ticked entry sets it again.
- `test-e2e/theme.spec.ts` is rewritten. The main new case runs in a browser that **prefers dark**: choose Light, then System, then reload, and expect dark each time after System. The old "press it again" test ran under a browser that prefers light, where a pinned page and a followed one look the same, so it couldn't catch the bug. It also covers a scheme change under an open page (`emulateMedia`): followed while on system, ignored while a scheme is pinned.

## Verification

- `vitest run`: 22 files, 319 tests passed.
- `nuxi typecheck` and `tsc -p tsconfig.tools.json --noEmit` (covers `test-e2e/`): both clean.
- `biome check packages/web`: clean.
- **Not run:** the Playwright suite and `nuxi generate`. The sandbox has no Chromium, and `/tmp` had 34 MB free. The e2e spec type-checks, but nobody has run it in a browser yet; that needs `pnpm --filter @navbook/web build && pnpm --filter @navbook/web test:e2e` before merging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
