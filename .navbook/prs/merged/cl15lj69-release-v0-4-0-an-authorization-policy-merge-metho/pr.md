---
title: "Release v0.4.0: an authorization policy, merge methods, commits and changes on the pull request page"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T00:36:19Z
target: main
source: dev
reviewer: morgan.peyre@brickcode.tech
labels: [release]
feature: [pull-requests, cli, server, web]
revisions:
  - head: 2ec89b00f9543c784d202c11f09a60eb63e2ef9a
    base: 2ebc8ce9a8af04648314137392b8e0b35b00c9a4
    date: 2026-09-27T00:36:19Z
merged:
  date: 2026-09-27T01:04:38Z
  by: Morgan PEYRE <morgan@peyre.info>
---

Releases v0.4.0: everything on `dev` since v0.3.0, the last version on npm.

That is 172 commits. 23 of them are more than tracker bookkeeping: 18 change code, and the rest are specification, the audit report and the version bump. Together they touch 159 files outside `.navbook/`. Ten pull requests merged into `dev` in that time: #ro4yvdyq, #b71aridn, #vuwoy2r9, #fwu4thb3, #u8584dxg, #ikhnz26e, #zno8oe2q, #xa7rux3u, #x1nqfqsq and #fxsdlc3u. The merge policy, the plugin specification and the audit report were committed to `dev` directly. The last commit sets every `package.json` to 0.4.0 and bumps the example `peerDependencies` in `doc/plugins.md` to match.

# Release notes — v0.4.0

`nav-server` can now decide who is allowed in, beyond whose token verifies. A deployment against a shared identity provider no longer has to admit everyone that provider knows. In the CLI, a repository can declare how `nav pr merge` lands a pull request, choosing from six methods that include rebase and squash. The browser client gains the Commits and Changes tabs on a pull request, links for `#<id>` references in prose, saves that show at once, a one-click "assign me", and search by ID.

Published: `@navbook/core`, `@navbook/cli` and `@navbook/server` at 0.4.0. `@navbook/web` is built and shipped in its container image, but it is not published to npm.

## Upgrading

- **`nav pr merge --no-ff` is gone.** Use `--method merge` instead. `--no-ff` is now an unknown option: `nav` prints `error: unknown option '--no-ff'` and exits 1, so a script that passes it must change. Nothing else changes by default. With no `merge` key in the marker the method is `auto`, which is exactly what 0.3.0 did.
- **A declared merge method is a new marker key.** `nav` 0.3.0 ignores `merge` in `navbook.json`, as the spec requires of unknown keys, and keeps merging as `auto`. Anyone who merges should upgrade before a repository declares a method. Otherwise the history takes a different shape depending on who merged.
- **The server can refuse a verified token** (#gkbu9yhp). No setting is required: a server started without a policy behaves as 0.3.0 did. At start it now logs `warning: no authorization policy; every token the provider signs for '<aud>' may read and write`. A deployment against a shared provider should set a policy:
  - **Compose:** `NAVBOOK_REQUIRE_CLAIMS`, `NAVBOOK_ALLOW_EMAIL_DOMAINS` and `NAVBOOK_REQUIRE_EMAIL_VERIFIED` in `.env`, empty by default. Every rule given must hold. For example, `NAVBOOK_REQUIRE_CLAIMS=roles=d3952bfb::developer`.
  - **`nav-server`:** `--require-claim <name>=<value>`, `--allow-email-domain <domain>` and `--require-email-verified`, or `NAV_SERVER_REQUIRE_CLAIMS`, `NAV_SERVER_ALLOW_EMAIL_DOMAINS` and `NAV_SERVER_REQUIRE_EMAIL_VERIFIED`. The first two repeat as flags and are comma-separated in the variables, so a value that contains a comma can only be given with the flag. A malformed claim or domain stops the server at start.
- **`NAV_SERVER_GRAPHIQL` is read strictly** (#gkbu9yhp). It used to mean "on unless exactly `false`". It now takes `true`, `yes` or `1` and `false`, `no` or `0`, in any case. An empty value counts as unset. Any other value stops the server at start. So `no` and `0` now turn GraphiQL off, and a value like `off` must change. Compose's default of `false` is unaffected.
- **Two new API error codes.** `FORBIDDEN` (HTTP 403) means the token verified but the policy refused it. A client must not send that person back to the provider, because they are signed in and it would loop. `MISSING_COMMIT` means the clone lacks the commits of the revision `Pr.commits` or `Pr.changes` was asked about.
- **Upgrade both images together.** The 0.4.0 web client asks for `Pr.commits` and `Pr.changes`, which a 0.3.0 server does not have. Compose's single `NAVBOOK_IMAGE_TAG` already moves both.
- **In core:** `MergeOptions.noFf` is replaced by `method`. `MergeStrategy` gains the replay and squash strategies. `SourceSync.outcome` gains `rebased` and `squashed`, and `MergeResult` reports the `method`.

## Features

### Who is allowed in: an authorization policy (#gkbu9yhp, #ro4yvdyq)

`nav-server` used to admit every token its provider signed for the audience. Against a provider shared with other projects, that meant everybody the provider knows could read and write. Nothing could sit in front of the server to stop it without verifying the same JWT again.

- **Three optional rules**, all ANDed, applied after the token verifies and before any operation runs, `viewer` and introspection included:
  - **A required claim:** equal to the value, or carrying it as a member when the claim is an array or a space-separated string. The same rule works for an array of roles, Better Auth's `roles` string and `scope`. A member that only contains the value (`developers` for `developer`) does not match. A value with a space in it is only ever compared whole.
  - **An allowed email domain:** the domain of the trimmed `email` claim, the address `author:` is written from, lower-cased. Subdomains do not match.
  - **A verified address:** `email_verified` must be exactly `true`.
- **Refusal:** a refused token gets `FORBIDDEN` and a 403, with a message that says only that the account is not allowed on this repository. The rule that refused it, and whom, goes to the server's log. Every value the token supplied is JSON-quoted there, so a claim somebody chose cannot forge a log line.
- **Safe defaults:** a repeatable flag given empty, such as `--require-claim "$UNSET"`, counts as not given. It cannot silently override the variable's list and open the server.
- **Web client:** a refused person lands on `/not-allowed`. It names the signed-in address and offers *Try again* and *Sign out*. Reached without a session, it offers *Sign in*. A refused write still gets its toast, because the person has just lost what they typed.
- **Development issuer:** its form takes a space-separated list of roles, minted as a `roles` array, and an "address is verified" box, minted as `email_verified`. Both sides of each rule can then be tried against a dev stack.

### A merge method for `nav pr merge`

A repository could already say how its reviews are counted, but not what shape a merge should leave. That was decided by whoever ran `nav pr merge`. The marker now takes a `merge` object with one key, `method`, and `nav pr merge --method <name>` overrides it for one merge:

| `method` | What lands on the target |
|---|---|
| `auto` | A fast-forward where the branches allow one, otherwise a merge commit. The default, and 0.3.0's behaviour. |
| `merge` | A merge commit, always. This is what `--no-ff` did. |
| `merge-ff` | A fast-forward only. |
| `rebase` | The source's commits replayed onto the target, then a fast-forward. |
| `rebase-no-ff` | The same replay, then a merge commit. |
| `squash` | The whole of the source's change as one commit. |

- **`merge-ff` is the only method that refuses.** It refuses before anything is read or written: `#<id> cannot fast-forward into <branch>, and this repository merges by 'merge-ff'`. It then suggests rebasing or merging the target into the branch, or `--method rebase`. It refuses a shape of history, not a review state, so review policies still never block a merge.
- **An unknown `--method`** is exit 1 with the list of valid names, before anything is touched.
- **The replay** uses `git rebase --onto`, so a branch that merged its target back in is flattened rather than refused. A replay that conflicts stops like a conflicted merge, and `--continue` finishes it. A method that cannot be carried out is reported, never swapped for another.
- **The source branch.** After a replay, the local source branch is moved onto the replayed commits, and `nav` prints `Rebased <source> onto <target>`. A source branch that was already pushed then differs from its remote copy. After a squash nothing moves, and `nav` says the branch's own commits are not on the target. Deleting or resetting it is left to you. Remote-tracking refs and branches checked out in another worktree are never moved, and `--no-sync-source` still leaves the source alone.
- **`--continue`** no longer relies on `MERGE_HEAD` alone, because a replay and a squash both stop without one. The merge records the pull request, the method and the target in the git directory before the step that can stop. A stale record left by `git rebase --abort` or `git reset --merge` is discarded, not treated as a merge in progress. `MERGE_HEAD` is still used for a merge that git holds and Navbook did not start.
- **`merged:`** has no `commit` key when the method made no commit of its own (`merge-ff`, `rebase`, `auto` when it fast-forwards). In those cases the follow-up commit carries the directory move as well.
- **`nav doctor`** reports a malformed merge policy under D15, beside the review policy's faults. The default is then used, as it is for the review policy.

### Commits and Changes tabs on the pull request page (#sfbidn0t, #zno8oe2q)

The pull request page has the three tabs every forge has, kept in the address as `?tab=`:

- **Conversation** is the page as it was.
- **Commits** lists what the latest revision introduces, `base..head` oldest first, with subject, author, date and short hash.
- **Changes** is that revision's diff against its merge base, file by file, with status letters, line numbers and the changed span marked within a replaced line. A binary file is labelled as binary.

Neither tab's data is fetched until the tab is opened, so the page opens as fast as before.

- **API:** `Pr.commits(limit)` and `Pr.changes(paths)`. Both read from the two SHAs the revision pins rather than from a branch, so a pull request found with `allRefs` works too. Neither takes the repository lock, and git runs asynchronously.
- **Large diffs:** every file is listed. Patches come inline until a per-file budget of 1,000 lines and a whole-diff budget of 10,000 lines are spent. A file past either budget shows its counts and a *Load diff* button. That fetches it by path, at most 20 paths a request, cut at 20,000 lines with `truncated` set.
- **Cache:** answers are cached for the life of the process under `base..head`. Two SHAs name an immutable answer, so entries are evicted only for memory, least recently used first. A diff that overruns git's buffer or 30 seconds falls back to a listing with lower-bound counts.
- **Speed:** on a clone of go-gitea/gitea, a 5,065-line diff painted every row in 357 ms from the click, and a 2,813-file diff painted its summary in 800 ms. Files below the fold render in idle batches under `content-visibility: auto`. `packages/web/script/bench-changes.ts` reproduces the measurement.
- **In core:** `commitsBetween`, `diffBetween` and `diffBetweenAsync`.
- **Not done:** syntax highlighting, the diffs of older revisions, and a side-by-side view.

### `#<id>` in prose is a link (#ll18jzkz, #u8584dxg)

A `#<id>` written in an issue body, a pull request's description or a comment is now a link. It used to be plain text, while the same reference in frontmatter was already a link.

- **How it resolves:** an ID does not say whether it names an issue or a pull request, so the link goes to `/ref/<id>`. That page asks the server and redirects with `replace`, so the page you were reading stays one Back away. It is usually one request.
- **Dangling references:** a reference to something the server has not fetched gets a page that says so and offers the listings.
- **What is recognised:** an ID must contain a digit, so `#deadline` is not linked. An escaped `\#<id>` is not linked either.
- **Navigation:** a click on an in-app link goes through the router rather than reloading the app. Only links that leave the app open in a new tab.
- **Known gap:** following a reference from `SpecEditor`'s preview discards the unsaved draft, as the sidebar's links already did. It is filed as #x8otoby0.

### A save shows at once (#fa19dlvj, #ikhnz26e)

An edit in the browser used to show the old value until the API answered, with no sign that a save was out. A refused save then lost what was typed to a toast.

- **At once:** the new value is shown from the moment the edit is sent. On the pull request page, a reviewer just asked for appears in the reviewer list as *Pending*.
- **Slow saves:** *Saving…* appears beside the field only when the wait passes 1.75 s, so a responsive server never shows it. The comment button no longer spins while an unrelated field saves.
- **Refusals:** a refused save stays beside its field with the server's reason, the value you typed, *Retry* and *Discard*. Retry sends the value again against the current version. `STALE_CONTENT` keeps its existing alert on the issue and pull request pages, and the feature page now uses that alert too.
- **Elsewhere:** a refused drag in the inbox stays where it was dropped, with the same Retry and Discard. The close-issue dialog stays open with its resolution when refused. An unlinked subtask disappears at once and comes back if the unlink is refused.

### Assign yourself in one click (#xfg8e516, #xa7rux3u)

The Assignees panel on both detail pages has a second button beside the pencil. It adds you to the list, or takes you off when you are already on it. Assigning yourself used to take five interactions and a search.

It writes you the way the server's `people` answer already spells you, matched by address. A token whose `name` differs from your git history therefore does not add a second spelling of you. Removing yourself removes every spelling of your address. Until `people` has answered, the button is not shown.

### Search by ID (#sfedl5jt, #x1nqfqsq)

A bare query term now also matches an entity whose directory name, `<id>-<slug>`, starts with it, from four characters. A leading `#` is allowed. `bqly`, `#bqlybac0` (quoted in a shell) and a whole directory name all find `#bqlybac0`. The ID match is anchored at the first character, so shorter terms and word searches return what they did before.

The change is in core's shared query, so `nav issue list`, `nav pr list`, the API's filter and the web client's search box all gain it. Spec 04, `nav list --help`, the README, the schema's `EntityFilter.text`, the search box placeholder and the inbox's empty state describe it. Quote the `#` form in a shell, which would otherwise read it as a comment.

## Fixes

- **Filtering by a person picked in the web client** (#rciuob4x, #b71aridn). The filter menus offer people as `Name <email>`. `assignee:`, `author:`, `reviewer:` and `awaiting:` refused that form for containing an `@`, so picking anyone listed nothing. The value is now parsed as a person and matched by address. The fix is in core, so the CLI and the API behave the same way.
- **The theme can follow the system again** (#qb86kmp0, #vuwoy2r9). The navbar control could only set light or dark, and the first press stopped the page following `prefers-color-scheme` for good. It is now a menu with System, Light and Dark. System follows a scheme change while the page is open.
- **Each page has its own browser title** (#umalw0cy, #fwu4thb3). Every page used to be called `Navbook`. Titles now read narrowest first and end in `· Navbook`, for example `#aaaa0001 Login times out on slow connections · Navbook`. A detail page is titled from its address at once, then gains the subject's title. A feature or specification document with no frontmatter title falls back to its slug or file name.
- **Pull request tabs stayed visible** (#mik7ws42, #fxsdlc3u). Once loaded, the Commits and Changes panels showed above whichever tab was selected. They are now hidden when another tab is chosen. A half-written review and loaded patches still survive switching tabs.
- **Found in review before release:**
  - **Tabs:** a diff that fell back to a listing called every file "No content change". Switching tabs discarded a half-written review. A failed commit walk was cached as an empty range for the life of the process.
  - **References:** escaped references were linked. `/ref/<id>` could send you forward again after you had pressed Back.
  - **Saves:** a refused inbox drop could not be cleared. Typing back the old value while a save was out was dropped.
  - **Assign me:** a list holding both spellings of one address was only half cleared.

## Documentation and specification

- **Merge policy:** spec 02 §2.10 adds the `merge` key and the six methods. §2.8 now says "the commit that lands it" rather than "the merge commit", and the `merged:` row describes when `commit` is absent. Spec 04 §4.3 documents `--method` with a table of what each method runs, how the source branch is reported, and how `--continue` finds its place. D15 covers the new key. The README describes the policy and the flag.
- **Extension namespaces and plugins, specified but not built** (#pr9o3vcf, part of #ywz73dxu):
  - **Spec 02 §2.12** reserves three places an extension may keep data: a top-level `<short>/` directory, `<short>/` or `<short>.*` in an entity directory, and `<short>-*` frontmatter keys. Every tool preserves them and interprets none of them. It also adds a `plugins` declaration to the marker.
  - **Spec 04** specifies `nav plugin install|remove|update|list`. Specs 03, 05 and 06 follow, and `doc/plugins.md` is the guide and list.
  - **None of it is implemented in 0.4.0:** there is no `nav plugin` and no `@navbook/plugin-kb`. The README, spec 04 and spec 05 describe them as if they shipped (#sle5dwk9), and D15 does not read `plugins` yet (#gqu14qtl).
- **Audit report:** `doc/audit-report/` is a full read of the codebase at 2ebc8ce. It has eleven reproduced findings, each open in the tracker, and a list of what was checked and found sound.
  - **The two rated high:** the API's `issues` query accepts pull-request-only filters, so `reviews: [PENDING]` matches every issue (#zlr44nen). The pre-commit hook blocks a commit on a non-format error when appended to a hook that uses `set -e` (#xb3jdz3q).
  - **Status:** this release fixes none of the eleven.
- **Server:** the README gains "Who is allowed in". The API spec describes the policy, `FORBIDDEN`, `Pr.commits`, `Pr.changes` and their budgets, and no longer says the server has no authorization.
- **Web:** the README and the client spec cover the tabs, reference links, what a save shows, the theme menu, the refusal page and the development issuer's new fields.
- **Query grammar:** spec 04 says a named address matches by its address alone, and that a bare term also matches an ID.
- **`.env.example` and `compose.yaml`:** they carry the three policy keys.

## Tests

All of it was run on `dev` at the version bump (2ec89b0), on Node 24.21 and pnpm 11.18.0, and passes: `pnpm check`, `codegen:check`, core 748, cli 346, server 344, web 373 (vitest), conformance 117 and deploy 63. After `pnpm build`, conformance passes 117 against the built CLI, and the Playwright suite passes 153 against the built bundle. The core, cli and server tarballs, packed and installed into an empty project, run `nav --version` (0.4.0), `nav init`, `nav issue open`, `nav doctor` and `nav-server --help`. The packed CLI depends on `@navbook/core` 0.4.0.

- **Conformance:** a valid `merge-policy` fixture and an invalid `d15-merge-policy` fixture.
- **Core:** `diff.test.ts` covers parsing, renames, binaries, quoting and ranges. There are new cases for merge methods, merge state, the merge policy reader and D15, named-address person matching, and matching by ID.
- **CLI:** `pr.test.ts` covers:
  - each method, read from the marker or given with `--method`;
  - the `merge-ff` refusal, which writes nothing;
  - an unknown `--method`, and a marker it cannot read;
  - a conflicted rebase and a conflicted squash finished with `--continue`;
  - a stopped merge that git was told to abandon, and a second merge refused on top of a stopped one.
- **Server:**
  - **Policy:** `policy.test.ts` and `config.test.ts` cover each rule and claim shape, flags against variables, the empty flag, the boolean spellings and the refusals. `authorization.test.ts` starts real servers with a policy and checks admission, the 403, mutations, `UNAUTHENTICATED` still coming first, and the quoted log line.
  - **Tabs:** `changes.test.ts` and `pr-changes.test.ts` cover the budgets, the cache, the fallback and missing commits.
  - **Search:** `read.test.ts` filters by the exact strings `people` returns.
- **Web:**
  - **Unit:** tests cover titles, the theme menu, pending edits, diff rows, prose references (held to core's `extractProseRefs`), people toggling, and the `FORBIDDEN` / `UNAUTHENTICATED` distinction.
  - **End-to-end:** new specs cover titles, the theme, reference links, saving feedback, self-assignment, the pull request tabs and search by ID.
- **Deploy:** the compose tests carry the new keys.
- **Lint:** `pnpm check` is green again. `.navbook` is no longer linted, since files attached to an issue are data. Three editors renamed a local `save()` that shadowed a prop.
- **Gap:** the `/not-allowed` page has no end-to-end test. The e2e stack helper cannot start a server with a policy yet.

## Before merging

- **Deployments:** decide on a policy before running the 0.4.0 images against a shared provider. Set `NAVBOOK_REQUIRE_CLAIMS`, `NAVBOOK_ALLOW_EMAIL_DOMAINS` or `NAVBOOK_REQUIRE_EMAIL_VERIFIED` in `.env`. Without one, the server starts as before and logs that it is open. Check that `NAVBOOK_GRAPHIQL`, if set, is one of the accepted spellings.
- **Scripts:** anything that calls `nav pr merge --no-ff` must switch to `--method merge`.
- **The README describes plugins that do not exist** (#sle5dwk9). This ships as it is: the fix belongs to that issue, not to the release, and the notes above say plainly that plugins are specified but not built.
- **Push `main`:** local `main` is 110 commits ahead of `origin/main`, which is still at `v0.3.0`. Push it along with this merge. No merge method is declared here, so `nav pr merge` fast-forwards `main` to `dev`. `dev` is also one commit ahead of `origin/dev`: the version bump.
- **Publishing:** after the merge, tag `v0.4.0` on `main` and push the tag. That triggers `release.yml`, which checks the tag against the core, cli and server versions, already 0.4.0.
- **Still true:** `nav pr merge` blocks nothing over reviews. It warns when the review policy is not met, then merges anyway. The only refusal is `merge-ff` over the shape of two branches.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
