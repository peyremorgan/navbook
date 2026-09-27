---
title: "D8 counts #id references inside fenced code blocks"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T02:26:24Z
labels: [bug, doctor]
feature: doctor
---

D8 counts a `#id` inside a fenced code block as a prose reference, and warns when it names nothing in the tree. On `dev` (at `2b8b0c5`), 3 of `nav doctor`'s 8 D8 warnings come from IDs in pasted terminal output:

- the comment `2026-09-16T173749Z-rg71ju17.md` on #gkbu9yhp: a JSON response from a scratch server, `"subject":"docs(issue): open #…"`
- the comment `2026-09-16T110456Z-ewd7wvz2.md` on #hslxi9a3: `git log --oneline` from a scratch repository
- #dzoq3o2v's description: a transcript of the intended `nav pr comment` prompt

Spec 02 §2.9 defines references **in prose**. The web client already agrees: `packages/web/app/utils/markdown.ts` links references only in markdown-it `text` tokens, so a `#id` in a fence or a code span is never linked. `PROSE_REF` in `packages/core/src/core/refs.ts` skips code spans through the backtick in its guard, but it reads fences as prose. The only way to quiet the warning today is to edit the pasted output, which then misreports what the tool printed.

## Fix

Make `extractProseRefs` ignore fenced code blocks (backtick or tilde fences, per CommonMark: a closing fence of the same character, at least as long as the opening one). An unclosed fence runs to the end of the document. Then D8, and the feature history that reads commit messages with the same function, both count exactly what the web client links.
