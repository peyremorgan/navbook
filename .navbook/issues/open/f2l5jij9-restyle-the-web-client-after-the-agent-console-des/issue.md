---
title: Restyle the web client after the agent-console design language
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:51:32Z
labels: [enhancement]
feature: web
assignee: Claude <noreply@anthropic.com>
---

The web client ships with Nuxt UI's stock look: green primary, slate neutrals, rounded corners, the system sans-serif. It should read as a sibling of the `agent-console` wall (`brickcode-factory/agent-console/web/src/app.css`): near-black navy surfaces, one copper accent, hairline borders, no rounded corners, IBM Plex Mono for text and Saira Condensed for uppercase, letter-spaced labels.

Not a verbatim copy. The console is a 1920×1080 TV canvas scaled to the screen, with 7–13 px type, no scrolling, no hover and no keyboard focus; a tracker is read up close, scrolls, is clicked and tabbed through, and holds paragraphs of Markdown. Take the tokens, the fonts and the idioms; keep the tracker's density, focus rings and readability.

## What to take from the console

Tokens, verbatim from its `:root` (it has no light mode at all — `color-scheme: dark` is hard-set):

```css
--bg: #0E1420;  --panel: #121A27;  --group-bg: #141D2B;  --card-bg: #18222F;  --agent-bg: #1C2735;
--line: #2A3648;  --grid: #1B2532;
--fg: #C9D2DE;  --muted: #8A97A8;  --dim: #5C6979;
--accent: #B87A45;  --accent-20: #B87A4533;
--s-done: #5E9C7A;  --s-run: #5B7FA6;  --s-review: #B87A45;  --s-integ: #7F7AA6;  --s-blocked: #B25C5C;  --s-plan: #6E7C8E;  --s-un: #3A4656;
--display: 'Saira Condensed', 'IBM Plex Mono', sans-serif;
--mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
```

Idioms worth keeping:

- **Surface ladder instead of shadows.** Four background steps and one border colour do all the depth work. No drop shadows, no blur.
- **Zero border radius**, everywhere except round status dots.
- **Mono body, condensed display.** `body { font-family: var(--mono) }`; Saira Condensed only for headers, badges, toggles and eyebrows — uppercase, tracked `.12em`–`.24em`. Emphasis is weight 500, never bold.
- **Status is a 3–4 px left border** on a card, plus an outlined badge: `border: 1px solid currentColor`, so one colour class tints text and border together.
- **One filled accent block**: the active segment of a toggle (`.tg.on { background: var(--accent); color: var(--bg) }`). Everything else is outline-only.
- **Finished work recedes** rather than disappearing (`.card.s-done { opacity: .7 }`).
- **Pane header**: uppercase, `.24em`, muted, 2 px bottom rule, with a right-aligned subtitle that carries the legend or a count.
- **Motion is opacity only**: pulse, blink, a `.6s` arrival flash, a text shimmer for placeholders.

Fonts are `@fontsource/saira-condensed` 500/600/700 and `@fontsource/ibm-plex-mono` 400/500 (both OFL-1.1), imported from `web/src/main.ts`. The bundle is static and offline-first, so the files should be vendored under `packages/web/public/fonts/` with our own `@font-face`, not fetched from Google.

## What it should look like here

- **Dark first.** The console's values, as they are, for the dark theme: `--ui-bg` #0E1420, `--ui-bg-muted` #121A27, `--ui-bg-elevated` #18222F, `--ui-bg-accented` #1C2735, `--ui-border` #2A3648, `--ui-text` #C9D2DE, `--ui-text-muted` #8A97A8.
- **Light stays usable.** A light theme derived from the same hues — cool off-white ground, navy text, the same copper — rather than a photographic inversion. It has to be designed, not just flipped: the console's accent and status colours all fail AA on white.
- **Accent** copper as `primary`, and, as in the console, the same copper for `warning`. Success sage #5E9C7A, info slate blue #5B7FA6, error brick #B25C5C.
- **Status on rows**: a coloured left border on issue, pull request and inbox rows. Open = in flight (slate blue), merged = done (sage), closed = dim. The status badge gets the console's glyphs (`○` open, `■` closed, `◈` merged, `◐` draft).
- **Toggles as segments**: status chips, sort chips and the nav tabs become a bordered segmented control with the filled-accent active state.
- **Headers**: page titles and section titles in Saira Condensed, uppercase, tracked; sidebar field names as eyebrows.
- **Kept from the tracker**: hover on rows, visible `focus-visible` rings, lucide icons beside the glyphs, scrolling, readable Markdown at a sensible measure.

## Contrast

Target WCAG AA (4.5:1 for text, 3:1 for large text) on every text element that carries content, in both themes. Decorative things — the hairline border, the "dim" tertiary grey on a disabled control — may fail. Measured against the four dark surfaces, the console's own values mostly do not pass as *text*:

| on #0E1420 / #18222F / #1C2735 | ratio | AA |
|---|---|---|
| `--fg` #C9D2DE | 12.1 / 10.5 / 9.9 | ✓ |
| `--muted` #8A97A8 | 6.2 / 5.4 / 5.1 | ✓ |
| `--dim` #5C6979 | 3.3 / 2.9 / 2.7 | ✗ — decorative only |
| `--accent` #B87A45 | 5.2 / 4.5 / 4.3 | ✗ on the top surface |
| `--s-run` #5B7FA6 | 4.4 / 3.8 / 3.6 | ✗ |
| `--s-blocked` #B25C5C | 4.0 / 3.5 / 3.3 | ✗ |
| `--s-done` #5E9C7A | 5.7 / 5.0 / 4.7 | ✓ |

So each hue needs a 50–950 scale: the console value near 500 for fills and borders, a lighter 400 for text on dark (copper #C98F5A 5.4:1, blue #7A9CC0 5.3:1, brick #CC7676 4.6:1 on the top surface), and a darker 600 for text on light (copper #8A5628 5.1:1, sage #356B4E 5.2:1, blue #375A80 5.9:1, brick #9A4040 5.5:1 on the light elevated surface). Nuxt UI reads `--ui-primary` from the 500 shade in light and the 400 in dark, so the light mapping has to be overridden to 600.

## Where it lives

- `packages/web/app/assets/css/main.css` — today two rules about `color-scheme`. Becomes: `@font-face`, `@theme static` with the four hue scales and the neutral ladder, `--ui-*` semantic tokens for `.light` and `.dark`, `--ui-radius: 0`, body font.
- `packages/web/app/app.config.ts` — does not exist yet. `ui.colors` naming the scales, and slot overrides so `UBadge` and `UButton` labels use the display font, uppercase and tracked.
- `packages/web/app/layouts/default.vue` — wordmark and nav.
- `IssueRow`, `PrRow`, `InboxRow`, `StatusBadge`, `ReviewBadge`, `SortOrderChips`, `EntityFilterBar`, `InboxRail`, `QueryState`, `CommentCard`, `MarkdownBody`, the `h1`/`h2`/`h3` on the pages.
- `packages/web/utils/entities.ts` — `statusColor` maps OPEN to `success` and MERGED to `primary`; becomes OPEN → info, MERGED → success, CLOSED → neutral.

## Tests

`packages/web/test-e2e/theme.spec.ts` proves the theme *switches*; nothing proves what it looks like. Add a spec that, in a browser preferring each scheme:

1. checks the vendored fonts are the ones that render (`document.fonts.check`, and the computed `font-family` on `body` and on a badge);
2. checks the radius token is zero on a listing container;
3. walks every visible element with its own text on the listing, the detail, the inbox and the header, composites its background up the tree, and asserts the WCAG ratio — 4.5:1, or 3:1 for large text — naming every offender. That is the AA target made executable, and it will catch a Nuxt UI variant the tokens did not reach.

The existing suite must stay green; it addresses everything by `data-testid`, so a restyle that keeps the test IDs and the roles should not touch it.
