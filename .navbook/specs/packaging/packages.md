---
title: Packages
---

## What exists

A pnpm workspace of four packages, published in lockstep under the `@navbook` scope (spec 05 §5.2):

- `@navbook/core` — the whole implementation in four layers, in dependency order: `core/` pure functions, `git/` subprocess calls to the user's git, `workspace/` a real tree on disk, `ops/` the verbs. No layer below the CLI writes to a stream or knows an exit code, and an operation that must stop and ask is split into a plan half and an execute half.
- `@navbook/cli` — argument parsing, `$EDITOR`, prompts and rendering; installs `nav`.
- `@navbook/server` — the GraphQL API; installs `nav-server`. A leaf: its dependencies constrain nothing else.
- `@navbook/web` — the browser client, built to static files and not published.

The two front ends are also shipped as container images, which is a separate story: see [docker.md](docker.md).

Node 24 runs the TypeScript sources directly, so development has no build step outside the web client. Each published package ships a compiled `dist/`, and the test suites honour `$NAV_BIN` and `$NAV_SERVER_BIN` so the same tests run against sources and builds. Releases pack all three, publish core first, and sign with provenance. Generated types — the server's resolver types and the client's documents — are committed, and CI checks they match the schema.

## Where it lives

- `pnpm-workspace.yaml`, `package.json`, each package's `package.json` and `tsconfig.build.json`
- `.github/workflows/{ci,release}.yml`

## Drift from the specification

- Spec 05 §5.2 says "three packages are published". Four exist and three are published, as §5.2 goes on to say of the web client; consistent, once read to the end.
- Spec 05 §5.3 describes a Rust rewrite to follow once the format stops moving. It has not begun.
