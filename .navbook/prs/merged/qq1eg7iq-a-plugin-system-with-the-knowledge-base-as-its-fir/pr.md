---
title: A plugin system, with the knowledge base as its first plugin
author: Claude <noreply@anthropic.com>
created: 2026-09-27T12:28:03Z
target: dev
source: feat/plugins
labels: [enhancement]
feature: plugins
revisions:
  - head: a64d9e6d60cc6b034a6e2b3291ca94cf2432ec78
    base: 47b8901f9b5722b952b96dd4818e59be38182cc5
    date: 2026-09-27T12:28:03Z
merged:
  date: 2026-09-27T12:28:30Z
  by: Claude <noreply@anthropic.com>
---

Brings the plugin system (#ywz73dxu, P0–P6) onto `dev`, with the knowledge base extracted into `@navbook/plugin-kb` as its first plugin. Until now the docs on `dev` described `nav plugin` and plugin-kb as shipped while nothing implemented them (#sle5dwk9). This makes them true.

`dev` had moved 174 commits past the branch, including 0.4.0 and the server read work (#yustj5ep, #egvv9205). So this is a merge, `a0ff6c0`, whose message says how each of the 18 conflicts was resolved, plus follow-ups.

## Carried across the merge
- **Plugin data goes through `dev`'s read path.** Plugin extensions reach every tree load and query. That includes the remembered tree, the comment scopes, and a context moved to another worktree. `commentScopeFor` now takes the extensions, so a plugin term that reads comments gets them.
- **The walk skips only an entity's own `comments/`.** Previously it also skipped a directory by that name inside a plugin's location, so a plugin saw a different tree depending on scope.
- **`dev`'s feature fixes are ported into plugin-kb:**
  - `baseSha` is the record's `blobSha`; there is no git hash-object.
  - `feature show` pads by terminal width.
  - A file that can't be read fails the load.
- **plugin-kb reads through `ctx.loadRepo`.** Feature pages share the request's parse and the tree remembered against HEAD.
- **`list --help` is `dev`'s generated grammar.** Plugins' terms are added from their manifests, and completion offers exactly what help documents.

## Fixed on the way
- **The per-field stale check stopped guarding `features`.** The extraction dropped `features` from the host's field list and nothing replaced it, so an edit from a stale page overwrote someone else's features without a word. The check now covers every field a plugin's bridge writes, compared by registered shape, so a respelling isn't a change, and named as the input spells it. An empty `baseSha` on `updateFeature` is refused again, as it was on `dev`.
- **`nav plugin install` refused plugin-kb's own tarball** with an npm ERESOLVE over its optional web peers. `release.yml` smoke-tests exactly that command, so the next tag would have failed. The fix is `--legacy-peer-deps`.
- **Server plugin services:** a service that failed to start left the ones before it running. Services now stop before the pull and the watchdog, and those two start only once the plugins have.
- **Versions:** plugin-kb was 0.3.0 and asked for core `^0.3.0`. It now releases in lockstep at 0.4.0, and a deploy test checks what `release.yml` checks.
- **`feature show --commits`** refuses values that aren't whole numbers (#kw143sq9).
- **Web e2e:** the host's e2e suite assumed `/features`, so a bundle built without the plugin failed. That assertion now lives in the plugin's suite.

## Tests added
- D15 conformance fixtures for the plugin declaration (#gqu14qtl). Each one fails against the pre-merge core.
- The feature and spec patch unit tests that the extraction had dropped, restored in plugin-kb.
- Freshness of features through the remembered tree: own writes, a push from elsewhere, and a hand edit.

## Verification
- An independent review of the merge found the stale-check gap above; both fixes are included.
- `pnpm check`, `codegen:check` and the full `pnpm test` pass twice: core 830, server 365, cli 389, plugin-kb 136, web 394, conformance 124, deploy 70.
- Web e2e passes on a fresh bundle with plugin-kb (154) and on one without it (144).
- Manual:
  - pack plugin-kb, then `nav plugin install` the tarball, use it and remove it;
  - completions;
  - the no-plugin CLI;
  - `bench-reads` with the plugin loaded.
- Docker images are not built locally; the CI `docker` job covers them.
- Not addressed, and already on `dev`: if `server.listen` fails, the server's services and timers keep running. Also still open, as follow-ups: #j35o7oe4 and #u0a6u6ev.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
