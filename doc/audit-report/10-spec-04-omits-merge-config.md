# 10 — Spec 04 does not document `nav install --merge-config`

**Tracked as:** `#e9v8jyz3` — `nav issue show e9v8jyz3`
**Severity:** Low — the CLI performs a `git config` write that its own reference
document does not list.
**Where:** [`doc/spec/04-cli.md:80-100`](../../doc/spec/04-cli.md#L80-L100) versus
[`packages/cli/src/commands/install.ts:92-102`](../../packages/cli/src/commands/install.ts#L92-L102)

## What is wrong

Spec 04 §4.3's "Setup" section gives `nav install` a synopsis and a bullet per
flag:

> - `nav install [--alias[=NAME]] [--hooks] [--completions[=SHELL]] [-y]` — set
>   up environment integrations:
>   - `--alias[=NAME]` — …
>   - `--hooks` — …
>   - `--completions[=SHELL]` — …
>
>   With no flags, `nav install` sets up everything: alias (default name), hook,
>   and completions (installed, not printed).

The CLI has a fourth flag and a fourth action:

```ts
// packages/cli/src/program.ts:136
.option("--merge-config", "set merge.directoryRenames=true in this repository")
```

```ts
// packages/cli/src/commands/install.ts:92-102
if (!selective || opts.mergeConfig !== undefined) {
  const current = readLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY);
  if (current === "true") {
    notes.push(`${DIRECTORY_RENAMES_KEY} is already true in this repository`);
  } else {
    actions.push({
      description: `git config --local ${DIRECTORY_RENAMES_KEY} true   (lets a comment racing a close merge cleanly)`,
      perform: () => setLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY, "true"),
    });
  }
}
```

`!selective` is true for a bare `nav install`, so "everything" is four things,
not three. `nav uninstall` unsets it symmetrically (`install.ts:148-155`).

## Why the omission is odd rather than harmless

Everything else in the repository treats this as a first-class part of setup.

The CLI's own description, which spec 04 §4.1 says is the binary's:

```
install [options]  set up the git alias, merge config, pre-commit hook and completions
```

The README, in its second code block:

```
nav install                # git alias, merge config, pre-commit hook, completions
```

and a paragraph arguing for it:

> The one setting worth knowing about is `merge.directoryRenames=true`, which
> `nav install` offers. Without it, the most common concurrent pair in Navbook —
> a comment racing a close — is placed correctly by git but still reported as a
> conflict to confirm. With it, that merge is clean.

Spec 03 §3.3.1 makes it a SHOULD for every repository using the format, and
names the command:

> Repositories using Navbook SHOULD therefore set:
>
> ```
> git config merge.directoryRenames true
> ```
>
> `nav install` offers exactly this, and it is the difference between "merges
> clean" and "merges correctly but stops to ask" for the single most common
> concurrent pair in the whole system.

So spec 03 tells the reader `nav install` does it, and spec 04 — the document
that defines what `nav install` does — does not mention it. A reader following
the reading order (§1 → §2 → §3 → §4) meets the claim before the reference that
should confirm it.

There is a second, quieter reason it matters. Spec 04's opening paragraph draws
a boundary:

> the CLI MUST NOT create or depend on state outside `.navbook/` (excepting
> disposable caches …, and the environment integrations that
> `nav install`/`nav uninstall` manage with the user's confirmation).

`merge.directoryRenames` is state outside `.navbook/` — in `.git/config` rather
than in the user's global config, unlike the alias — and it is inside the
exception only because it is one of the integrations `nav install` manages. A
document that does not list it does not obviously cover it.

## Suggested fix

One bullet and one word in the synopsis:

```diff
-- `nav install [--alias[=NAME]] [--hooks] [--completions[=SHELL]] [-y]` — set
-  up environment integrations:
+- `nav install [--alias[=NAME]] [--hooks] [--merge-config] [--completions[=SHELL]] [-y]`
+  — set up environment integrations:
   - `--alias[=NAME]` — run `git config --global alias.<NAME> '!nav'` …
   - `--hooks` — install the `pre-commit` hook described in 4.5.
+  - `--merge-config` — set `merge.directoryRenames=true` in this repository's
+    own config, which is the SHOULD of [03 §3.3.1](03-merge-and-branches.md):
+    it is what makes a comment racing a close merge clean rather than stopping
+    to ask. Local rather than global, since it is a property of a repository
+    using Navbook and not of the person.
   - `--completions[=SHELL]` — …

-  With no flags, `nav install` sets up everything: alias (default name), hook,
-  and completions (installed, not printed).
+  With no flags, `nav install` sets up everything: alias (default name), hook,
+  merge config, and completions (installed, not printed).
```

and the same word in the `nav uninstall` bullet below it, which currently says
"no flags: everything it may have installed" — true, and now with a fourth thing
in it.

## Test gap

`packages/cli/test/cli/install.test.ts` covers the flag. What is not covered is
the agreement between the spec's list and the command's — which is the kind of
thing a test cannot reasonably assert, and is why documentation drift is worth
an audit finding rather than a regression test.
