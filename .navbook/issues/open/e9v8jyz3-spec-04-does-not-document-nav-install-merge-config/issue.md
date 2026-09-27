---
title: Spec 04 does not document nav install --merge-config, which a bare nav install performs
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:40:06Z
labels: [bug, install]
feature: cli
---

Spec 04 §4.3's "Setup" section gives `nav install` a synopsis and a bullet per flag — `--alias`, `--hooks`, `--completions` — and closes with "With no flags, `nav install` sets up everything: alias (default name), hook, and completions (installed, not printed)."

The CLI has a fourth flag and a fourth action:

```ts
.option("--merge-config", "set merge.directoryRenames=true in this repository")
```

```ts
if (!selective || opts.mergeConfig !== undefined) {
  const current = readLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY);
  if (current === "true") { … } else {
    actions.push({
      description: `git config --local ${DIRECTORY_RENAMES_KEY} true   (lets a comment racing a close merge cleanly)`,
      perform: () => setLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY, "true"),
    });
  }
}
```

`!selective` is true for a bare `nav install`, so "everything" is four things, not three. `nav uninstall` unsets it symmetrically.

## Why the omission is odd rather than harmless

Everything else treats this as first-class. The CLI's own description: `install [options]  set up the git alias, merge config, pre-commit hook and completions`. The README: `nav install  # git alias, merge config, pre-commit hook, completions`, plus a paragraph arguing for it. And spec 03 §3.3.1 makes it a SHOULD for every repository using the format *and names the command*:

> Repositories using Navbook SHOULD therefore set: `git config merge.directoryRenames true`. `nav install` offers exactly this, and it is the difference between "merges clean" and "merges correctly but stops to ask" for the single most common concurrent pair in the whole system.

So spec 03 tells the reader `nav install` does it, and spec 04 — the document that defines what `nav install` does — does not mention it. A reader following the reading order meets the claim before the reference that should confirm it.

There is a second, quieter reason. Spec 04's opening paragraph draws a boundary: "the CLI MUST NOT create or depend on state outside `.navbook/` (excepting disposable caches …, and the environment integrations that `nav install`/`nav uninstall` manage with the user's confirmation)." `merge.directoryRenames` is state outside `.navbook/` — in `.git/config`, unlike the alias which is global — and it is inside the exception only because it is one of the integrations `nav install` manages. A document that does not list it does not obviously cover it.

## What it should do

One bullet and one word in the synopsis, plus the same word in the `nav uninstall` bullet below it:

```diff
-- `nav install [--alias[=NAME]] [--hooks] [--completions[=SHELL]] [-y]`
+- `nav install [--alias[=NAME]] [--hooks] [--merge-config] [--completions[=SHELL]] [-y]`
   - `--alias[=NAME]` — …
   - `--hooks` — install the `pre-commit` hook described in 4.5.
+  - `--merge-config` — set `merge.directoryRenames=true` in this repository's
+    own config, which is the SHOULD of 03 §3.3.1. Local rather than global,
+    since it is a property of a repository using Navbook and not of the person.
   - `--completions[=SHELL]` — …

-  … everything: alias (default name), hook, and completions.
+  … everything: alias (default name), hook, merge config, and completions.
```
