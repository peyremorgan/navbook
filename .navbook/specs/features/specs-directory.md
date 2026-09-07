---
title: The specs directory
---

## What exists

A feature is `specs/<slug>/`, holding a `feature.md` identity card and any number of Markdown documents (spec 02 §2.11). It has no ID, because its name is what an entity's `feature:` key names, and no status, because a standing concept does not open and close. Nothing lists its members: an issue or pull request names the features it belongs to, so two people attaching two issues never touch one file.

- **Attach** — `feature: auth` or `feature: [auth, mobile]` on `issue.md` or `pr.md`; `--feature` on `nav issue open` and `nav pr open`; `feature:` in a listing query; the Features section of an issue's page.
- **CLI** — `nav feature open|list|show|edit`, `nav feature spec add|edit|list`. `show` renders the card, the documents, the attached work and the commits that touched any of it.
- **History** — a commit counts when it changed the feature's documents, a member's directory, or names a member by ID in prose or a `Refs:`/`Closes:` trailer. Derived from `git log` on demand, never stored, and cut to a limit.
- **API** — `Feature`, `Spec`, `Commit`; `createFeature`, `updateFeature`, `addSpec`, `updateSpec`. Documents are served by name, looked up among those already parsed, so no name a client sends is ever joined onto a path.
- **Editing** carries the hash the editor started from; a save whose file has moved on is refused with `STALE_CONTENT` rather than landed on top of somebody else's paragraph.
- **Doctor** — D13 for the layout and schema of `specs/`, D14 for a `feature:` naming a directory this tree lacks.
- **Reading is more generous than writing**: a hand-written `Session Policy.md` is a document; a tool only mints slug-shaped names and never `feature.md`.

`specs/` is not part of the `nav init` skeleton. The first feature brings it with it.

## Where it lives

- `packages/core/src/ops/feature.ts`, `core/tree.ts`, `git/history.ts`
- `packages/cli/src/commands/feature.ts`
- `packages/server/src/resolvers/feature.ts`
- `packages/web/app/pages/features/`, `components/SpecEditor.vue`, `utils/timeline.ts`

## Drift from the specification

- Spec 04 §4.3 writes `[-m TEXT | --edit]` on `nav feature open` and `nav feature spec add`, copying the wording of the issue verbs. No `--edit` flag exists on any of them.
- Spec 05 §5.4 asks for an operation fixture for every command. `feature edit`, `feature spec edit` and `feature spec list` have none; the CLI suite covers them instead.
