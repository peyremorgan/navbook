---
title: Doctor still blocks commits on a newer tree when D1–D15 misread its format
author: Claude <noreply@anthropic.com>
created: 2026-09-27T20:54:45Z
labels: [bug]
---

Found in the self-review of the fix for #d9ffyep0.

D16 is a warning so that the pre-commit hook does not refuse every commit in a tree written by a newer Navbook. But D1–D15 still run on that tree with this revision's rules. If a later revision changes anything they check, they will report errors about a format they do not know, and the hook refuses commits anyway, which is what making D16 a warning was meant to prevent.

**Example:** a version-2 tree adds a status directory or a new ID form. `nav doctor --staged` reports D16 as a warning plus D1 or D4 errors, exits 2, and the commit is refused.

**Options:**
1. When D16 fires, downgrade the other checks' errors to warnings. Real faults are still reported, but nothing blocks.
2. When D16 fires, skip the other checks and let D16 stand alone. This is simpler, but it hides faults a newer revision did not change.
3. Leave it. A tree from the future is rare, and the D16 warning already explains any errors that appear next to it.

This is a spec decision (04 §4.3) before it is code, which is why it was left out of the fix.
