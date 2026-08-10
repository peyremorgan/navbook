---
title: Issue decomposition and sub-tasks
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-08-10T08:58:21Z
resolution: fixed
---
I would like to be able to link issues together, using a bidirectional "parent"/"subtask" relationship. Other types of relation might be needed in the future, but they are out of scope for this issue.

Subtasks and parent task should be stored as references in the Markdown frontmatter of the issue files.

There should be no limit to the depth of a task tree. Subtasks can themselves have subtasks.

The `doctor` command should detect (and optionally fix) broken links

The `nav issue show` should display the title and status of the parent and/or child tasks, if any.
