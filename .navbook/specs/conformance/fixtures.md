---
title: Fixtures
---

## What exists

`doc/spec/fixtures/` holds plain, browsable files plus a `case.yaml` per case; the harness in `test/conformance/` materialises a deterministic git repository, runs one command against `$NAV_BIN`, and compares exit code, stdout, the resulting tree and the commits made (spec 05 §5.4).

- **Format fixtures** — valid trees that must produce no diagnostics, hand-edit oddities included, and invalid trees with the diagnostics they must produce, compared by check, level and path only.
- **Operation fixtures** — before-tree, command, after-tree, exit code and stdout for the CLI verbs, `feature` verbs included.
- **Merge fixtures** — the scenario table of spec 03 §3.3 as replayable histories with expected post-merge trees.
- **Determinism** — `NAV_NOW` and `NAV_IDS` replace the clock and the ID generator; git identity, dates, locale and configuration are pinned; SHAs are placeholders substituted at comparison time.
- **Recording** — `node test/conformance/record.ts` regenerates expectations; what it records is what the implementation does, so the diff is read against the specification before it is committed.

The suite runs against the sources in `pnpm test` and against the compiled `dist/` build in the release job.

## Where it lives

- `doc/spec/fixtures/`, `test/conformance/{harness,record,run.test}.ts`

## Drift from the specification

- Spec 05 §5.4 asks for an operation fixture "for every CLI command". `uninstall`, `feature edit`, `feature spec edit` and `feature spec list` have none.
- Spec 05 §5.3–5.4 describe differential testing between two implementations. The Rust rewrite has not been started, so nothing runs the suite against a second binary yet; the `$NAV_BIN` hook that would is in place.
