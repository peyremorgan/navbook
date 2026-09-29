---
title: "Release v0.5.0: plugins, with the knowledge base as the first; sign-out that ends the session; a guard for unsaved work"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T10:29:28Z
target: main
source: dev
reviewer: morgan.peyre@brickcode.tech
labels: [release]
revisions:
  - head: aa86a393f9fcf04f093ebd13c01d8f4e9c69e4a4
    base: b93ca766fdce43cdfdc79f85ce396abc6a3d49d9
    date: 2026-09-29T10:29:28Z
---

Releases v0.5.0: everything on `dev` since v0.4.0, plus the fixes from the release review (#aocfb72n) and the version bump.

That is 455 commits. 292 of them are tracker bookkeeping and 20 are merges. Of the other 143, 112 change code, tests or packaging, and 31 change only documentation and specification. Together they touch 382 files outside `.navbook/`. Twenty-six pull requests merged into `dev` in that time: #yustj5ep, #dzoq3o2v, #gte1bbun, #jrfa2qtw, #wur9pmi6, #j5fnqki4, #rw1mjrnv, #feu6fmzu, #yfxlq5jc, #zhdz48sn, #mbdo32eh, #j99l8arg, #or1dk86r, #evhwf1da, #oc6i8mp2, #qq1eg7iq, #gingv6nc, #njfzket6, #kefxsqu0, #sbmd4a95, #d8oflfva, #krc96gzg, #rw0y8xsq, #kqft4ykl, #j24jq6vj and #aocfb72n. #yustj5ep merged minutes before the v0.4.0 release did, but it was not part of v0.4.0. The last of them is the release review. The last commit sets every `package.json` to 0.5.0. It also moves plugin-kb's `@navbook/core` peer range, and the example in `doc/plugins.md`, to `^0.5.0`.

# Release notes — v0.5.0

Navbook now has plugins. The knowledge base (features under `specs/`, their documents, and the `feature:` key) has moved out of the core into `@navbook/plugin-kb`, the first plugin. A repository that uses features has to declare the plugin, and each machine has to install it. In the browser, signing out now ends the identity provider's session too, and the client asks before a navigation throws away unsaved work. In the CLI, a pull request can be written from any checkout: `nav` offers to do the write in the worktree that has the branch, or in a temporary one. The API's reads are about ten times faster on a warm issue page. The server now runs git's housekeeping itself, under tini, so a stop no longer leaves locks in the clone. All eleven findings of the September audit are closed.

Published: `@navbook/core`, `@navbook/cli`, `@navbook/server` and, new in this release, `@navbook/plugin-kb`, all at 0.5.0. `@navbook/web` is built and shipped in its container image, but it is not published to npm.

## Upgrading

- **Features are a plugin now** (#ywz73dxu, #qq1eg7iq). Without it, `nav` has no `nav feature`, no `--feature` and no `feature:` query term. The API has no `Feature`/`Spec` types and no `features` fields, and the web client has no `/features`, no Features tab and no feature chips. A `nav` without the plugin still keeps `specs/` and every `feature:` key exactly as they are. It prints one line saying `.navbook/specs/ belongs to @navbook/plugin-kb, which .navbook/navbook.json does not declare`. A repository that has a `specs/` directory, or any `feature:` key, needs two steps:
  - **Declare it, once per repository.** In `.navbook/navbook.json`, add `"plugins": {"@navbook/plugin-kb": {}}` and commit the change.
  - **Install it, once per machine.** Run `nav plugin install kb`. With no argument, `nav plugin install` installs whatever the repository declares and the machine lacks. Plugins go to a store that `nav` owns, `$XDG_DATA_HOME/navbook/plugins` or `~/.local/share/navbook/plugins`, so it does not matter how `nav` itself was installed. The store is filled with `npm install --ignore-scripts`, so `npm` has to be on `PATH`.
- **Plugin names are package names.** A key under `plugins` in `navbook.json` must be a plugin's npm package name: `@navbook/plugin-<name>`, `navbook-plugin-<name>` or `@scope/navbook-plugin-<name>`. `nav-server` refuses to start on any other name, a path in particular, and says why. `nav plugin install` accepts only packages named that way that also carry the `navbook-plugin` keyword. It accepts a short name (`kb`), which it tries as `@navbook/plugin-kb`, then as `navbook-plugin-kb`.
- **`nav-server` refuses to start when the clone declares a plugin that is not installed beside it**, and names the plugin. `NAVBOOK_PLUGIN_PATH` loads a plugin under development without declaring it.
- **The images carry only the plugins named in `NAVBOOK_PLUGINS`.** It is a new key in `.env`, empty by default. Compose passes it to both builds, as `NAVBOOK_PLUGINS` to the API image and as `NAVBOOK_WEB_PLUGINS` to the web image. It is read when the images are built, so a change needs `docker compose build && docker compose up -d`. A deployment that serves a repository with features must set `NAVBOOK_PLUGINS=@navbook/plugin-kb`. Otherwise the web bundle has no knowledge base, and the API refuses to start over the declaration. The web image can compile only the plugins in this repository's workspace. Today that means `@navbook/plugin-kb`, and a third-party plugin named here fails the web build.
- **`@navbook/core` no longer exports the feature operations.** `listFeatures`, `findFeature`, `featureMembers`, `featureCommits`, `createFeature`, `addSpec`, `editFeature`, `editSpec`, `applyFeatureEdit`, `referencedFeatures` and their types are gone, along with `FeatureRecord`, `SpecRecord`, `SPECS_DIR`, and `Repo.features`/`featureBySlug`. They live in `@navbook/plugin-kb/core` now. Core gains the plugin surface (`plugins.ts`, `extensions.ts`).
  - **`NavTree`** is `{ keys(); get() }` rather than a `ReadonlyMap` (#zhdz48sn). A `Map` still satisfies it. Code that used `readNavTree`'s result as a `Map` (`.size`, `.has`, iteration) does not.
- **A tree written by a newer Navbook is a warning, D16** (#d9ffyep0, #kqft4ykl). `nav doctor` now reads the marker's `version`.
  - Absent or `1` passes as before.
  - A whole number above 1 is D16, a warning: `'version' is 2 and this tool reads 1: the tree was written by a newer Navbook; update nav`. `doctor` still exits 0, so the pre-commit hook does not block. Every verb that reads the tree prints the same warning on stderr before doing anything else.
  - Any other value (`"1"`, `null`, `1.5`, `0`) is a D15 error.
  - `nav init` writes the format version it reads.
- **D15 reads the `plugins` declaration** (#gqu14qtl, #or1dk86r). A `plugins` value that is not an object, or an entry that is not an object, is a D15 error. `nav doctor --staged` catches them, so the pre-commit hook stops them.
- **Refresh the pre-commit hook** (#xb3jdz3q, #evhwf1da). The old block blocked a commit on exit 1 when the host hook used `set -e`. Exit 1 is an operational error, not a format violation. Run `nav install --hooks` once more: 0.5.0 replaces an older Navbook block in place and leaves the rest of the hook alone.
- **Numeric flags refuse bad values when parsed** (#kw143sq9, #j99l8arg). `--commits`, `--depth`, `--count` and `--rank` now fail with commander's usage error, for example `error: option '--commits <n>' argument '2.5' is invalid. Expected a whole number of commits.`. The exit code is still 1. A script that greps stderr for the old `nav: --depth …` or `nav: --rank must be a number` must change. `nav id -n 2.5` no longer mints 2 IDs.
- **The API's filter input is split in two** (#zlr44nen, #oc6i8mp2). `@navbook/web` ships in lockstep with the server, but any other client must change in four ways:
  - `EntityFilter` is now `IssueFilter` and `PrFilter`.
  - `IssueFilter.status` takes the new `IssueStatus` enum (`OPEN`, `CLOSED`), so `status: [MERGED]` on `issues` is refused.
  - A term of the other noun (`reviews`, `reviewers` or `awaiting` on `issues`, `deadline` on `prs`) fails GraphQL validation, with `GRAPHQL_VALIDATION_FAILED` and HTTP 400. This holds even when the term is empty (`deadline: []`). Send only your own noun's keys.
  - `Issue.features` and `Pr.features` exist only while plugin-kb is loaded. Every entity gains `ext: JSON!`, which holds each loaded plugin's data under its short name, and is `{}` on a server with no plugins.
- **`Feature.commits(limit: -1)` is refused** with `INVALID_INPUT`, as `Pr.commits` already was.
- **`baseSha` is computed from the text for features and specs too** (#qjzq3024, #j5fnqki4). Nothing changes in a repository without clean filters or end-of-line conversion. In one that has them, a page opened before the upgrade gets its next save refused as stale, and a reload fixes it.
- **The API image.**
  - **tini:** the image runs under `tini -s` (#rcsql1v9, #gingv6nc), which reaps the git processes left to PID 1. Compose now refuses an `entrypoint:` on the `api` service, because it would replace tini. `init: true` beside it still works.
  - **Housekeeping:** the server runs git's maintenance on the clone itself (#cvb57nhm, #j24jq6vj). Every git the server starts runs with `maintenance.auto=false`. Instead, `git maintenance run --auto` runs in the foreground after a fetch or a write, at most once per `--maintenance-interval-ms` / `NAV_SERVER_MAINTENANCE_INTERVAL_MS`. The default is 300000, and Compose sets it from `NAVBOOK_MAINTENANCE_INTERVAL_MS`. `0` turns it off, with a startup warning.
  - **Startup clean-up:** at start the server removes the maintenance and ref-packing locks, and the temporary files, that an interrupted run left, and names each one in the log. It never removes a lock on the index, HEAD, a ref or a reflog, and removes nothing while a git runs in the clone.
  - **`stop_grace_period`:** it is now 75 s on the `api` service. That covers a fetch and a push at the default `NAVBOOK_GIT_TIMEOUT_MS` of 30 s, plus the 5 s a maintenance run gets. Raise the two together.
  - **Port:** a port that cannot be bound is now a startup error that stops whatever had started.
- **Hand edits in the served clone** are now seen within one pull interval rather than on the next read (#yustj5ep). With `--pull-interval-ms 0` they are still seen at once. A mutation still fetches first.
- **Signing out needs the provider to allow it** (#icroff4l, #njfzket6). When the provider's discovery document names an `end_session_endpoint`, **Sign out** now goes there. The provider must let the client end sessions and accept `<web origin>/signed-out` as a post-logout redirect URI. Otherwise Sign out stops on the provider's error page, although the local token is gone. For Better Auth, that means `enableEndSession: true` on the OAuth client, and the URI in `postLogoutRedirectUris`. A provider without the endpoint keeps the old behaviour.
- **In the CLI:** the five pull-request write verbs (`edit`, `comment`, `update`, `request`, `review`) may now ask a question at a terminal. A run with nobody to ask still refuses with exit 1, as before.

## Features

### Plugins, and the knowledge base as the first one (#ywz73dxu, #qq1eg7iq)

A plugin is one npm package, recognised by its name and the `navbook-plugin` keyword. It implements whichever parts it needs, as `exports` subpaths: `./core` (files, frontmatter keys, query terms, doctor checks), `./cli` (commands, options, columns, completions), `./server` (GraphQL types and resolvers, background services) and `./web` (a Nuxt layer). A repository declares a plugin in `navbook.json`, and each machine installs it. Declaring a plugin never fetches or runs anything.

- **`nav plugin install|list|update|remove`.** A bare `install` offers the declared plugins that are missing, shows the npm command it will run, and asks first. `-y` answers for you. `list [--json]` shows what is installed and whether this repository declares it. The verbs work outside a repository. `remove` and `update` take short names. `install` records what npm actually installed, and keeps versions and URLs as you typed them.
- **Core:** plugin registrations go through every tree load and query. A plugin may not claim a built-in directory, key, query term or check id. A plugin that cannot load is named (`nav: plugin <name> could not be loaded: …`), and the other commands keep working.
- **CLI:** plugin commands, options on built-in verbs, listing columns and JSON keys are built from the plugin's manifest. `list --help` and completion include plugin query terms.
- **Server:** plugin schema is merged in, and plugin services start before the port opens and stop before the clone is released. Each plugin hears every mutation once it has committed, with whether the push went through. A plugin's own fields get the same per-field stale check as the host's. A plugin's settings come from `NAV_SERVER_<SHORT>_*` variables.
- **Web:** plugin layers are merged at build time, and have places to appear in the host's pages: nav links, detail panels on issues and pull requests, fields on the new-issue form, filter chips, row badges and inbox groupings.
- **`@navbook/plugin-kb`** carries features, specification documents, `feature:`, D13 and D14, `nav feature`, the `Feature` and `Spec` API, and the `/features` pages. Its checks keep their numbers because the format still defines `specs/` and `feature:` (spec 02 §2.12 grandfathers them). A tree with features is conforming whoever reads it.

### Signing out ends the provider's session (#icroff4l, #njfzket6)

**Sign out** used to remove only the stored token. The provider's cookie then signed the same account straight back in on **Sign in again**. The client now sends the provider an end-session request with the id token as `id_token_hint`, and comes back to `/signed-out`. A request refused as UNAUTHENTICATED while signing out no longer starts a new sign-in that could overtake the sign-out. The development issuer gains an `/end-session` endpoint, so the end-to-end suite checks the whole round trip.

### Asking before unsaved work is lost (#x8otoby0, #kefxsqu0)

A navigation that would throw away something you typed now asks first, in an in-app dialog with **Keep editing** and **Discard and leave**. Escape and a click outside mean stay.

- **What counts as unsaved:** an open in-place editor whose draft differs from the value, a comment or review with text in it, anything typed on the new-issue form, the knowledge base's editor and its add-document and new-feature dialogs, and a refused edit still kept beside its field.
- **What asks:** a change of path inside the app, a reload or a closed tab (the browser's own prompt), signing out, and a token refused as UNAUTHENTICATED or FORBIDDEN. After an UNAUTHENTICATED refusal, "stay" keeps the page, the draft and the token, and a toast says to copy the text out.
- **What does not ask:** a change of query only, such as a pull request's `?tab=` or a listing's filters, and an edit that is still being saved.

### Writing to a pull request from another checkout (#tvxw30h3, #dzoq3o2v)

A pull request is written on its source branch, so `nav pr edit`, `comment`, `update`, `request` and `review` used to refuse from any other checkout. At a terminal they now offer an alternative:

- **Another worktree has the branch** and its tracked files are clean (untracked files don't count): `Write it there? [y/N]`. The write happens there, and the calling checkout's HEAD, index and files are left as they were. `pr update` then records the head actually under review.
- **No worktree has the branch** but it exists locally: `nav` offers to check it out in a temporary worktree under `TMPDIR`. The worktree is removed after `--commit`, after a no-op or after a failure. Without `--commit`, it is kept with the write staged in it, and `nav` prints the `git worktree remove` to run later. A branch that only a remote-tracking ref carries is not offered.
- **`-y`/`--yes`** accepts either offer in advance. A dirty worktree is named in the refusal, so the missing offer is explained.

### Faster reads and a cheaper pre-commit hook

- **API reads** (#esqpmn7i, #yustj5ep):
  - The server fetches in the background, so reads never wait on the network.
  - It parses the tree once per request, reads only the comments a request needs, and parses flat frontmatter without building a YAML document.
  - It remembers the parsed tree across requests, keyed on HEAD. The cache is dropped on every write, and a `git status` watchdog notices hand edits.
  - On a 2,194-file tree, a warm issue page went from 896–1,213 ms to 91 ms. The first load after an idle interval went from about 3 s to 103–110 ms. `packages/server/script/bench-reads.ts` reproduces the measurement.
  - `issues { comments }` no longer answers `[]`.
- **Only the files the parser reads are read** (#egvv9205, #zhdz48sn). Extension data and images are listed but never opened. On the issue's repro, `nav issue list` went from 142 MB to 97 MB of memory.
- **`nav doctor --staged`** (#j35o7oe4, #d8oflfva) reads the index with four git processes rather than one `git show` per file. On this repository that is 3.1–3.7 s down to 0.56 s on every commit, with byte-identical output. A blob over 1 MiB is read only if the parser asks for it.
- **The cross-branch pull request scan** (#u0a6u6ev, #krc96gzg), behind `pr list --all-refs`, `pr show` from another branch and `pr merge`, reads each distinct tree once and skips extension data. Across 20 branches, that took 903 git processes down to 217, and 2.29 s down to 1.66 s. A 270 MB file in a pull request's directory used to make the pull request vanish without a word. Now it is listed. A batch that git cannot answer is an error, where it used to be an empty answer.
- **One blob reader** (#rw0y8xsq) now serves both paths. Its buffers are sized per batch, it checks every header's type, and it reports git's own error when git stops early.

## Fixes

- **D10 dated merged pull requests from their merge** (#f2dnig9s, #feu6fmzu). `git log --follow` does not see a rename inside a merge commit, which is where `nav pr merge` moves a pull request's files. File histories now carry on through the merge, choosing the parent by rename score. The two false D10 warnings on this repository are gone.
- **D8 counted references inside code** (#t1kpljkt, #yfxlq5jc). `#id` in fenced code, indented code or a code span is no longer a reference, and neither is an escaped `\#id`. A feature's history reads commit messages the same way.
- **D10's timestamp check returned the opposite of what its name said** (#ze71ym9e, #jrfa2qtw). D10 itself was right, but the function's contract was not. It now returns a result, and the warning gives the actual gap. The first D10 conformance fixtures come with it.
- **`list --help` drifted from the parser** (#rz9rqg8h, #wur9pmi6). It left out `deadline:` and offered the review terms on `nav issue list`, where they are refused. Help and completion are now generated from the parser's own term list, per noun.
- **Listing cells broke non-ASCII text** (#ozzaoa36, #rw1mjrnv). A narrow terminal could split an emoji into U+FFFD, and CJK titles pushed the columns out of line. Cells are now measured in terminal columns and cut between grapheme clusters.
- **Two `baseSha` implementations** (#qjzq3024, #j5fnqki4). Features and specs hashed through `git hash-object`, which applies filters. Entities hashed the text. Everything now hashes the text, so a feature edit is not refused under a clean filter.
- **Zombie git processes in the API container** (#rcsql1v9, #gingv6nc). An image that pushed a commit every 2 s for 40 s had 63 zombies. Under tini it has none.
- **A stop could cut git's housekeeping short** (#cvb57nhm, #j24jq6vj). A stale `packed-refs.lock` then failed every `fetch --prune`, and so every request. See Upgrading for how the server handles housekeeping now.
- **An unlistable directory hid its entity** (#sbmd4a95). A directory the tree walk could not read used to drop its issue without a word. It is now an error, as an unreadable file already was.
- **Found in the release review (#aocfb72n).** Seven reviewers read `dev` at `6842e4d`, and a second pass reviewed the fixes themselves:
  - **Blockers:**
    - A plugin name in `navbook.json` could be a path. `nav-server` would then import code from the served clone, which made push access into code execution. Names are now checked against npm's whole package-name grammar, and the package found must carry that name and the keyword.
    - `feature:` values were committed without validation. The API and `nav issue/pr open` stopped checking them when features moved into the plugin.
    - Every web build carried plugin-kb, whatever the image was told.
    - One branch with a file at `prs/open` broke every cross-branch pull request lookup.
  - **Core:**
    - The fast frontmatter reader treated NBSP as YAML whitespace.
    - Prose references now find code exactly where markdown-it does (0 block-structure divergences in a 100k-document fuzz), in linear time.
    - Plugin version ranges are read as npm reads them.
    - A gitlink, an unreadable `comments/` and a branch named like a `git worktree` option are handled.
  - **Server:**
    - Shutdown aborts the background fetch and its children rather than waiting for it.
    - An unbindable port is a startup error.
    - The 75 s stop grace period.
    - The docs say when a mutation event reports `pushed: false`.
  - **CLI:**
    - `plugin install` records what npm installed and keeps URLs as URLs.
    - Contributed options reach shared verbs, and plugin columns reach `pr list`.
    - `--commits` refuses `0x10` and `1e1`.
    - `nav install --hooks` updates an older block.
    - A plugin that throws while registering is skipped and named.
  - **plugin-kb:**
    - `feature open` and `spec add` refuse to overwrite an unparseable file.
    - The stale check is per field, so your second quick edit is not refused against your first.
    - Slugs are written once, and the timeline count is fixed.
  - **Web:**
    - Sign-out does not ask the leave question again on the way back, and waits for a token renewal in flight.
    - One "Discard and leave" also answers the browser's prompt.
    - A failed re-sign-in leaves no agreement behind.
    - The plugin panel is disabled with the rest of a read-only pull request page.
    - Plugin filters stay on their own noun.
    - An untouched editor no longer counts as unsaved.

## Documentation and specification

- **Plugins:** spec 02 §2.12, spec 04's `nav plugin`, spec 05's fifth package and `doc/plugins.md` describe what now exists. For a while they were marked reserved (#sle5dwk9, #mbdo32eh), and #qq1eg7iq made them true. `packages/plugin-kb/README.md` and `packages/plugin-kb/doc/spec.md` are the plugin's own. The README lists five packages and has a Plugins section.
- **Marker:** spec 02 §2.10 defines the two `version` cases. Spec 04 §4.3 adds D16 to the table and says why it is a warning. The check ranges in spec 05 and the fixtures README are updated.
- **`nav install --merge-config`** (#e9v8jyz3, #gte1bbun) is documented in spec 04 §4.3. Spec 03 §3.3.1 says the setting does nothing when `merge.renames=false`.
- **The pull request write offer:** spec 04 §4.2 gains a MAY for the five verbs, including that a run with nobody to ask must still refuse.
- **Spec 05 §5.2** lists the CLI's dependencies, with `string-width` among them.
- **Server and deployment:** the server README, the root README and spec 06 §6.3 describe the housekeeping and what the server clears at startup. `.env.example` and `compose.yaml` carry `NAVBOOK_MAINTENANCE_INTERVAL_MS`, `NAVBOOK_PLUGINS` and the grace period, and say that the web image compiles only workspace plugins.
- **Web:** the web README and `.env.example` say what the identity provider must allow for sign-out.
- **API:** `schema.graphql` describes `baseSha` as an opaque token rather than a blob hash. It explains why `IssueFilter` and `PrFilter` are separate inputs.
- **Audit report:** all eleven findings in `doc/audit-report/` are now closed. That includes the two rated high (#zlr44nen, #xb3jdz3q).

## Tests

At the head of `fix/release-review`, before the version bump: `biome`, `tsc` for every package, `nuxi typecheck` and the codegen checks (server, web and plugin-kb) were clean. The core, CLI, server, plugin-kb, web unit (419), conformance and deploy suites passed. The full Playwright suite passed 169/169, across the web and plugin-kb projects.

The steps of `release.yml` were run locally on `release/0.5.0` (dec2e57), in a fresh clone on Node 24 and pnpm 11.18.0. Everything short of the publish passed:
- `pnpm install --frozen-lockfile`, `pnpm check`, `codegen:check`, `pnpm test` and `pnpm build` all pass.
- Conformance passes 128/128 against the built CLI.
- The four tarballs pack at 0.5.0: core, cli, server and plugin-kb.
- The consumer smoke test passes. `nav --version` prints 0.5.0, then `nav init`, `issue open` and `doctor` run. The plugin is installed from its tarball, then `feature open` and `feature list` run, and `nav-server --help` resolves.

- **Conformance:** fixtures for the plugin declaration under D15, the marker version (D15, and D16 with exit 0), and the first D10 fixtures. The suite loads plugin-kb for `valid/features`, and skips plugin cases only when `NAV_SKIP_PLUGINS` asks.
- **Core:**
  - `history.test.ts` builds real repositories for moves inside merges.
  - A table of 18 constructs holds prose references to markdown-it.
  - `parsedPaths` has a contract test, and a `git` shim on `PATH` shows that extension data is never requested.
  - Staged-tree and blob-reader tests check batching and lazy reads.
- **CLI:**
  - Each worktree offer and its teardown.
  - The hook under `set -eu`, both the exit-1 and exit-2 cases, and the in-place update of an older block.
  - Numeric flag refusals.
  - Help and completion held to the parser.
  - Grapheme-safe truncation.
  - The plugin verbs, and a fixed number of git processes for `doctor --staged`.
- **Server:**
  - The background pull, the tree cache over HTTP, and the filter split.
  - Maintenance runs, stops, leftovers and `GIT_CONFIG_COUNT`.
  - Plugin resolution, which refuses path-like names.
- **Web:**
  - Unit tests for the unsaved-work registry and the end-session request.
  - End-to-end specs for unsaved work: 10 in the host, 4 in plugin-kb.
  - Sign-out through the development issuer's `/end-session`.
- **Deploy:**
  - The image starts through `tini -s`, and Compose has no `entrypoint:` override.
  - The plugin build arguments.
  - The release workflow's version check.
- **Gap:** four of the review's web fixes live in middleware, plugins and components and have no unit test. The e2e suite covers the flows they touch.

## Before merging

- **The API image does not build** (#uniyh2hy). `docker build -f packages/server/Dockerfile` fails at the packing step since the plugin merge, and so do `docker compose build` and the CI `docker` job. Its fix, PR `#vi0kmykg`, is waiting for review. The npm release does not depend on the images, but a deployment does.
- **The API Dockerfile's plugin loop mangles `name@range`.** It rewrites any `@navbook/plugin-*` name into a tarball glob, so `@navbook/plugin-kb@^0.5`, or a registry-only first-party plugin, fails `npm install`. PR `#vi0kmykg` also touches that Dockerfile, which is why the review left this alone.
- **Third-party plugins cannot be compiled into the web image.** The web build installs nothing from the registry. This release documents the limit and does not lift it.
- **Deploying this tracker:**
  - This repository declares `@navbook/plugin-kb`, so the deployment's `.env` needs `NAVBOOK_PLUGINS=@navbook/plugin-kb`, or the API will not start.
  - Before the new web image goes out, check that the provider's OAuth client allows ending sessions and lists `/signed-out`.
- **Pushing:**
  - Local `main` is level with `origin/main`, both at the v0.4.0 merge (`b93ca76`).
  - Local `dev` is 271 commits ahead of `origin/dev`, and other sessions keep committing to it.
  - No merge method is declared, so `nav pr merge` fast-forwards `main` to `dev`.
- **Publishing:** after the merge, tag `v0.5.0` on `main`, then push `main`, `dev` and the tag. That triggers `release.yml`. The workflow now checks the tag against the core, cli, server and plugin-kb versions, which are already 0.5.0. It installs the plugin-kb tarball through `nav plugin install` in its smoke test, and publishes plugin-kb last, after core, cli and server.
- **Still true:** `nav pr merge` blocks nothing over reviews. It warns when the review policy is not met, then merges anyway.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
