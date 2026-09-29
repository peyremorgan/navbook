# Test plans and runs

**Normative.** This document defines the data `@navbook/plugin-tests` keeps in
a Navbook tree, in the sense the [Navbook specification](../../../doc/spec/README.md)
defines the rest of it. A plugin that owns data must publish one
([02 §2.12](../../../doc/spec/02-data-model.md)), because a tree is meant to
outlive the tool that wrote it, and data nobody can look up is data nobody can
keep.

The key words MUST, SHOULD and MAY are used as the Navbook specification uses
them.

## 1. What this is

A **test plan** is a standing document describing a manual test: what to set
up, then an ordered list of steps, each an action and the result it should
produce. It is named by a slug, like a feature ([02 §2.11](../../../doc/spec/02-data-model.md)),
and has no ID and no status: it does not open or close, it is edited.

A **test run** is the record of somebody executing a plan once, against a
commit or a version: what they observed at each step, as far as they got. A
run is one file, named like a comment ([02 §2.6](../../../doc/spec/02-data-model.md)),
so two testers recording at once can never conflict. A run either stands on its
own, beside its plan, or is **attached to a pull request**, inside that pull
request's directory — where it travels with the pull request through merge,
close and archive, and is written on the branch under review, exactly as a
review is.

What a run *concluded* — its outcome — is never stored. It is derived from the
steps the run records (§6), so it cannot disagree with them.

## 2. Where the data lives

This plugin's short name is `tests`. It occupies two of the namespaces
[02 §2.12](../../../doc/spec/02-data-model.md) reserves, and no frontmatter key:

| What | Where |
|---|---|
| Plans | `tests/<slug>/plan.md` |
| Standalone runs | `tests/<slug>/runs/<stamp>-<id>.md` |
| Runs attached to a pull request | `<pull request directory>/tests/<stamp>-<id>.md` |
| A run's attachments | a directory beside the run, named like it without `.md` |

```
.navbook/
├── tests/
│   └── login-flow/
│       ├── plan.md
│       └── runs/
│           ├── 2026-09-20T101500Z-r7k2m9x1.md
│           └── 2026-09-20T101500Z-r7k2m9x1/
│               └── console.png
└── prs/open/dk3mp2x9-auth-refactor/
    ├── pr.md
    └── tests/
        └── 2026-09-21T090000Z-t3w8p1q4.md
```

- `tests/` MUST NOT contain files directly. Each subdirectory is one plan.
- A plan directory's name is the plan's **slug**. It MUST match
  `^[a-z0-9]+(-[a-z0-9]+)*$` (the slug grammar of 02 §2.3) and MUST NOT match
  the ID grammar of 02 §2.2 — so that wherever a tool accepts "a plan or a
  run", the two can never be confused.
- A plan directory MUST contain `plan.md`. It MAY contain `runs/`. Anything
  else in it MUST be preserved and MUST NOT be interpreted.
- `runs/`, and `tests/` inside a pull request directory, MUST contain only run
  files (§4) and attachment directories (§5).
- `tests/` inside an *issue's* directory has no meaning here; like any extension
  namespace nobody claims, it is preserved.
- `archive/…/tests/` at the top of the root is not read, for the reason an
  archived `specs/` is not. A pull request's own `tests/` is read wherever the
  pull request is, archived or not: it is still that pull request's.

## 3. `plan.md`

```markdown
---
title: Login flow
author: Alice Smith <alice@example.com>
created: 2026-09-20T10:00:00Z
---

Sign in from a clean browser profile. Needs a staging account.

### Open the login page

#### Actions

Browse to `/login`.

#### Expected

The form shows, with empty fields and no error banner.

### Sign in with a valid account

#### Actions

Enter the staging account's credentials and press **Sign in**.

#### Expected

The dashboard opens within two seconds.
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `title` | MUST | string | The plan's name, for display |
| `author` | MUST | person | Who wrote it |
| `created` | MUST | timestamp | When it was written |

A plan MUST NOT carry `status`. Unknown keys are preserved (02 §2.4).

### 3.1 Body grammar

The body is Markdown. Only ATX headings (`#` to `######` followed by a space)
are structure, and a line inside a fenced code block (```` ``` ```` or `~~~`)
is never a heading.

- Text before the first level-3 heading is the plan's **description**:
  preconditions, scope, anything the tester should read first. It MAY use
  level-1 and level-2 headings.
- Each `### <title>` opens a **step**. Steps are numbered by position, from 1.
  A number the author wrote at the start of the title (`### 2. Sign in`,
  `### 2) Sign in`) is display only and MUST be ignored for numbering. The
  title MUST NOT be empty.
- Inside a step, `#### Actions` MUST appear exactly once: what the tester does.
  `#### Expected` MAY appear once: what they should observe. A step without it
  is a **setup step**, which has nothing to check but is still recorded.
- Section names are matched without regard to case or surrounding space. A tool
  writes them as spelled here.
- Inside a section, deeper headings (`#####`, `######`) are text.
- These are faults: a `####` heading before the first step; any other `####`
  section in a step, or one appearing twice; a `#` or `##` heading after the
  first step.

A plan MAY have no steps yet. Nothing can be run against it until it has one.

## 4. Run files

A run file's name is `<YYYY-MM-DDTHHMMSSZ>-<id>.md`, the grammar of a comment's
file name (02 §2.6). The timestamp is when the run started, in UTC; the ID is a
fresh ID of 02 §2.2, and MUST be unique among every entity, comment and run ID
in the repository.

```markdown
---
plan: login-flow
plan-sha: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
steps: 2
author: Bob Jones <bob@example.com>
started: 2026-09-21T09:00:00Z
finished: 2026-09-21T09:12:40Z
commit: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d
version: 1.4.0-rc1
environment: Firefox 141 on staging
---

Second revision of the pull request.

### 1. Open the login page

#### Status

passed

### 2. Sign in with a valid account

#### Status

failed

#### Actual

A spinner for thirty seconds, then a blank page; the console shows a 500 from
`/api/session`.

![console](2026-09-21T090000Z-t3w8p1q4/console.png)
```

| Key | Req. | Type | Meaning |
|-----|------|------|---------|
| `plan` | MUST | slug | The plan that was run |
| `plan-sha` | SHOULD | 40-hex | The git blob hash of `plan.md` as it was when the run started |
| `steps` | SHOULD | integer ≥ 1 | How many steps that plan had |
| `author` | MUST | person | The tester |
| `started` | MUST | timestamp | When the run started |
| `finished` | MAY | timestamp | When the tester said they were done; absent while the run is in progress |
| `commit` | MAY | 40-hex | The commit that was tested |
| `version` | MAY | string | The version that was tested, by name: a release number, a build |
| `environment` | MAY | string | Where it was tested |

- At least one of `commit` and `version` MUST be present: a run that does not
  say what was tested records nothing anybody can use.
- A run has no key naming a pull request. Being inside one's directory is what
  attaches it, and moving the directory carries the run.
- `plan-sha` is what makes a run readable after its plan changes: the exact
  steps the tester followed are the blob it names. `steps` says the same thing
  more cheaply, so that a tool holding only the run file — a listing of pull
  requests read out of other branches, a forge's file view — can still tell a
  complete run from an incomplete one. A tool that creates a run MUST write
  both.
- Values that YAML would read as something else — a version like `1.10`, a
  hash made only of digits — MUST be quoted. A tool writing them does so.

### 4.1 Body grammar

The grammar of §3.1, with different sections.

- Text before the first level-3 heading is the run's **notes**.
- Each `### <n>. <title>` records one step of the plan: `<n>` is the step's
  number in the plan (§3.1), and the title after it is display only (a tool
  writes the plan's title at the time). Each step is recorded at most once, and
  `<n>` MUST NOT exceed `steps` when that is present. A tool writes them in
  order.
- `#### Status` MUST appear exactly once and hold exactly one word, one of
  `passed`, `failed`, `blocked` and `skipped` (matched without regard to case).
- `#### Actual` MAY appear once: what the tester observed, as Markdown. It MAY
  link the run's attachments by relative path.
- A step of the plan with no section is **not run**.
- These are faults: a missing or malformed number; a number repeated; a missing
  or unknown status; any other `####` section, or one appearing twice; a
  `####` heading before the first step; a `#` or `##` heading after it.

| Status | Meaning |
|---|---|
| `passed` | The step did what it was expected to |
| `failed` | It did not |
| `blocked` | It could not be carried out: an earlier failure, an environment down |
| `skipped` | It was deliberately not carried out |

## 5. Attachments

A run MAY keep files — screenshots, logs — in a directory beside it named like
the run file without `.md`. Their content is never interpreted and MUST be
preserved. An attachment directory with no run file beside it is a fault.

## 6. The outcome of a run

Derived from the run's recorded steps, in this order, and never stored:

1. any step `failed` → **failed**;
2. otherwise any step `blocked` → **blocked**;
3. otherwise, when every step of the plan is recorded: **skipped** if every one
   of them is `skipped`, else **passed**;
4. otherwise, when `finished` is present → **incomplete**;
5. otherwise → **in-progress**.

"Every step of the plan" means steps 1 to the plan's step count, which is
`steps` when the run carries it. A run without it is judged against the plan
`plan-sha` names when a tool can read that blob, and otherwise against the plan
in the tree, and a tool SHOULD say so; with no plan at all, rule 3 cannot apply.

A pull request's **tested** state is the outcome of its newest run — by file
name, which is the order a listing shows them in — whose `commit` is the head of
the pull request's latest revision (02 §2.7), or **none** when it has no such
run. Like a review decision, it is a reading of the files: nothing gates on it,
and a new revision returns it to `none`.

## 7. What a tool without this plugin does

A tool that does not know this plugin MUST preserve `tests/` and every
`tests/` inside a pull request directory, and MUST NOT interpret them
(02 §2.12). Closing, merging and deleting a pull request carry its runs with its
directory, and `doctor` reports nothing about them. The reference `nav` says
once that `tests/` belongs to `@navbook/plugin-tests` when the marker does not
declare it.

## 8. Checks

Numbered in the extension series of spec 04 §4.3.

- **X-tests-1** (error) — the layout of §2 and the grammars of §3 to §5: a file
  directly in `tests/`, a plan directory whose name is not a slug or is an ID,
  a plan directory without `plan.md`, a file in `runs/` or a pull request's
  `tests/` that is not a run, an attachment directory without its run, and every
  schema or body fault in a plan or a run.
- **X-tests-2** (warning) — what a branch nobody has fetched might yet explain:
  a run whose `plan` names no plan in this tree; a run attached to a pull
  request whose `commit` is none of its revisions' heads. With history to ask
  (`nav doctor` on a working tree): a `plan-sha` this clone holds no blob for,
  a `commit` it holds no commit for, and a `steps` that disagrees with the plan
  `plan-sha` names.
- **X-tests-3** (error) — a run ID that is also another run's, an entity's or a
  comment's. Check D3 does not see runs, so this is its counterpart.

## 9. Commits

A change this plugin makes uses the scope `tests` (spec 03 §3.2):

| Change | Subject |
|---|---|
| Create a plan | `docs(tests): create <slug>` |
| Edit a plan | `docs(tests): edit <slug>` |
| Start a run (and anything recorded with it in one commit) | `docs(tests): run <slug> <run id>` |
| Record steps of a run | `docs(tests): record <slug> <run id>` |
| Finish a run | `docs(tests): finish <slug> <run id>` |
| Attach files to a run | `docs(tests): attach <slug> <run id>` |

A change to a run attached to a pull request adds ` on #<pr id>` to the subject
and a `Refs: <pr id>` trailer. A run ID is written bare, never as `#<id>`:
references resolve to entities and comments (02 §2.9), and a run is neither.

## 10. Settings

None. The declaration is an empty object:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-tests": {}
  }
}
```
