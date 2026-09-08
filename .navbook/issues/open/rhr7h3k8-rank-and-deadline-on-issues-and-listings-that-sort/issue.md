---
title: Rank and deadline on issues, and listings that sort by them
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-08T04:20:39Z
labels: [enhancement]
feature: issues
---

An issue can say what it is and who holds it, but not where it sits in the queue or when it is wanted. Two frontmatter keys close that:

```yaml
rank: 20
deadline: 2026-10-01
```

`rank` is a relative priority in the kanban sense rather than a bucket: a decimal, lower first, so a row can always be dropped between two others by halving the gap. `deadline` is a calendar date with no time part, which is the only spelling of a due date with no timezone to disagree about.

Both are issue-only, as `parent` and `subtasks` are (§2.5). A pull request is a proposed change that lands or does not, and what orders its queue is the review state it already has.

**Sorting is a reading, not a stored order.** Core keeps listing newest first and the API gains no sort argument: an order the server owned would be an index, and §6.6 refuses one. Each front end sorts what it is handed — `nav issue list --sort priority|deadline|newest`, and chips on the web listings. The inbox is the one that defaults to `priority`, because it is the page that answers "what next".

**Reordering writes one file.** A drop between two ranked rows takes the midpoint, one past either end takes ten clear of it, and a row dropped into the unranked tail is ranked last of all. Nothing is renumbered, so two people reordering different work never touch the same line. The handle is a button as well as a drag source, so the same move is Space, arrow keys, Space.

Surfaces: `--rank` and `--deadline` on `nav issue open`, columns on `list` when something carries them and rows on `show`; `deadline:overdue` and `deadline:none` in the query grammar, refused on `nav pr list` as `reviewer:` is refused on issues; both keys on `Issue`, in `EntityFilter` and in both issue inputs; a number field and a date field on the issue page and the filing form; and a badge that reads "due in 3 days" or "2 days overdue".
