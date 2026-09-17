---
title: Navigating away from an editor discards unsaved work without asking
author: Claude <noreply@anthropic.com>
created: 2026-09-17T21:57:59Z
labels: [bug]
feature: web
---

Nothing in the web client asks before navigating away from unsaved work. A
specification document is the clearest case, because it is the longest thing
anybody types here: open `SpecEditor`, write a few paragraphs, click Issues in
the sidebar, and the draft is gone with no prompt and nothing to undo with.

The same is true of a comment being written and of a field opened for editing
with `EditableText`. `useStaleEdit` protects the other half of this problem
carefully — an edit refused because somebody else saved first is kept and shown
beside what the file now says, rather than thrown away — which makes the gap
noticeable: work is guarded against a concurrent save and not against a click.

## How it comes up

1. Go to a feature, open one of its documents and click Edit.
2. Type into the body.
3. Click anything that navigates — a sidebar link, the breadcrumb, a link in
   the Preview pane.
4. The editor is gone and the text with it.

## Where it lives

- `packages/web/app/components/SpecEditor.vue` holds `body` as plain component
  state; `tab === 'preview'` renders that same unsaved string through
  `MarkdownBody`.
- Nothing in `packages/web/app` calls `onBeforeRouteLeave`, and there is no
  `beforeunload` handler, so neither an in-app navigation nor closing the tab
  is guarded.

## Worth knowing before fixing it

A tempting narrow fix — have links inside a preview open a new tab instead of
routing in place — does not work here. The token is kept in `sessionStorage`
on purpose, so that it goes when the tab does
(`packages/web/app/plugins/02.auth.ts`), which means a new tab has no session
and lands on the identity provider rather than on the page that was asked for.
Verified against the e2e stack while reviewing #u8584dxg.

So the guard belongs to the page that owns the unsaved work, covering every
way out of it, rather than to the component that renders one of them.
