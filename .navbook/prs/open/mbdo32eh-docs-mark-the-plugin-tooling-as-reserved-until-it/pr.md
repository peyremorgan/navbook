---
title: "docs: mark the plugin tooling as reserved until it lands"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T10:06:11Z
target: dev
source: fix/sle5dwk9-reserve-plugin-docs
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: ba214dbbbb72de6e50c60bd7c2016267abaa454b
    base: 1f34c63cd9cbe62573b6bc55f016c68da1e1a7db
    date: 2026-09-27T10:06:11Z
  - head: e40b3e4af1465cfb06fcf879e9227097b7a86ed7
    base: 47b8901f9b5722b952b96dd4818e59be38182cc5
    date: 2026-09-27T10:45:50Z
---

Fixes #sle5dwk9: follows the implementation plan in its comments, plus the four extra passages the confirmation comment found.

`nav plugin` and `@navbook/plugin-kb` do not exist on `dev` (`nav plugin install` exits 1 with "unknown command"), but five documents described them as shipped. Documentation only, no code:

- **README.md**: the Plugins transcript of a failing command becomes one paragraph saying the format half is in force and the commands are specified but not built. "Five packages" becomes four, and the broken `packages/plugin-kb/README.md` link is gone. The features paragraph now says features are *on their way* to becoming a plugin.
- **spec 04 §4.3**: heading marked `(reserved)`, with a marker paragraph, the inverse of 06 §6.3's `(built)`. The preamble's pointer to it and §4.4's bullet say "reserved" too.
- **spec 05 §5.2**: the fifth package is "planned", and says features are in core/cli until it exists. The **Plugins** bullet is marked planned and moved to the future tense.
- **spec 02 §2.12**: one sentence, from "has moved" to "intends to move". This is the only edit in a normative chapter, and it is about what the reference implementation has done, not a MUST or a shape. Please check it.
- **doc/plugins.md**: a Reserved banner that names every unbuilt thing the guide mentions (`CorePluginHost`, `NAVBOOK_PLUGIN_PATH`, `NAVBOOK_WEB_PLUGINS`, `NAVBOOK_PLUGINS`). The dead link in the plugin table is replaced by "(planned)".

Spec 02 §2.10 and §2.12 substance is untouched, and so is #gqu14qtl (D15). A comment on #dgure4qm (P6) lists what to undo when the plugin work lands.

Checks: `nav doctor` is 0 errors, 10 warnings, the same as `dev` before and after. No code or tests are touched, and no test reads these documents.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
