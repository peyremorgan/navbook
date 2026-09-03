# 5. Implementation

## 5.1 Strategy

Two implementations are planned, in sequence:

1. **TypeScript reference implementation** (now). It defines behavior wherever
   the prose spec is ambiguous, survives as the implementation behind the web
   client's server, and serves as the cross-check oracle for:
2. **Rust CLI rewrite** (when the format and CLI surface have stabilized). At
   that point the Rust binary becomes the recommended installation for CLI use,
   and the TypeScript codebase refocuses on the web/GUI layer. The two are kept
   in agreement by the conformance suite (5.4).

This ordering was chosen after a measured bake-off (5.5): TypeScript wins the
iteration speed that a young, still-moving spec needs most, while Rust wins
distribution and invocation latency — which matter most exactly when the tool
is mature and widely installed.

## 5.2 TypeScript reference implementation

- **Runtime:** Node ≥ 24 (runs TypeScript natively — no build step in
  development). Three packages are published to npm under the `navbook` org
  scope, in lockstep at one version: `@navbook/core`, the implementation;
  `@navbook/cli`, which depends on it and installs the `nav` binary; and
  `@navbook/server`, the GraphQL API of [06 §6.3](06-future.md), which installs
  `nav-server`. All ship a compiled JS `dist/` so installed code does not depend
  on type-stripping behavior; `npx @navbook/cli` is the zero-install trial path.
  A fourth, `@navbook/web`, is the browser client of [06 §6.3](06-future.md) and
  is not published: it is a static bundle to be served, not a dependency to be
  installed, and it is the one package here that needs a build step.
- **Dependencies:** deliberately minimal. A YAML parser (`yaml`) in the core
  and an argument parser in the CLI; no framework. Every dependency added to
  the core is a liability for the Rust rewrite (behavior to reproduce) and MUST
  be justified. The server is a leaf: its GraphQL and token-verification
  dependencies are reproduced by nothing and constrain no other package.
- **Structure:** `@navbook/core` is four layers in dependency order — `core/`
  (pure functions: parse/serialize/validate/query/plan — no I/O, no git),
  `git/` (subprocess calls to the `git` binary; no libgit bindings, so
  Navbook's git behavior is definitionally the user's git), `workspace/`
  (reading and mutating a real `.navbook/` tree, plus the context an operation
  runs in), and `ops/` (the verbs of [04 §4.3](04-cli.md), each taking resolved
  inputs and returning what happened). `@navbook/cli` is argument handling,
  `$EDITOR` and prompt interaction, and rendering over `ops/`.
- **Why the split is load-bearing:** `core/` is the layer the Rust rewrite must
  reproduce function-for-function. The library as a whole is what lets a second
  front end exist without reimplementing anything — the API server behind the
  web client ([06 §6.3](06-future.md)) runs the same operations the CLI does. Two rules keep that true: no layer below `cli/` writes to a stream or
  knows what an exit code is, and an operation that must stop and ask is split
  into a plan half and an execute half rather than calling back into its caller.
  A front end that cannot stop and ask answers the question in its request
  instead: the server takes an explicit flag where the CLI prompts.
- **Performance budget:** cold `nav issue list` on a 1 000-issue repo MUST
  complete in under 500 ms on commodity hardware. (Measured floor: ~40 ms
  Node startup + ~110 ms with one heavy import — import cost is the budget's
  main enemy; `core` stays dependency-light for this reason too.)

## 5.3 Rust rewrite (planned)

- Single static binary named `nav`; `cargo install navbook` (crate keeps the
  project name, binary is `nav`) / prebuilt release artifacts / distro
  packages; the git alias mechanism (4.1) is identical.
- Shells out to `git` exactly like the TS implementation — behavioral parity
  includes the git layer.
- YAML note for implementers: `serde_yaml` is archived; use a maintained fork
  and keep frontmatter usage within the YAML subset both ecosystems parse
  identically (plain scalars, block maps/lists, quoted strings — the spec's
  examples define this subset de facto).

## 5.4 Conformance testing

The spec ships (in a future `doc/spec/fixtures/` tree) golden repositories:

- **Format fixtures:** valid trees that MUST parse (including hand-edit
  oddities: unknown keys, archive/ subtree, prefix-length IDs), and invalid
  trees with the doctor diagnostics (D1–D12) they MUST produce.
- **Operation fixtures:** (before-tree, command, after-tree, exit code,
  stdout-shape) tuples for every CLI command.
- **Merge fixtures:** the scenario table of [03 §3.3](03-merge-and-branches.md)
  as replayable git repositories with expected post-merge trees.

Both implementations MUST pass the same fixture suite; the Rust rewrite is
additionally validated by **differential testing** — running both binaries over
generated random repositories and diffing outputs (`--json` modes make this
byte-comparable).

## 5.5 Language bake-off record (2026-08-02)

Basis for 5.1. Two behaviorally identical PoC servers (byte-identical HTML)
rendering a 1 000-commit repo's history; axum 0.8 vs fastify 5.11 on Node
24.18; autocannon, 50 connections, 10 s measured after warmup; i7-4700HQ.

| Metric | Rust | Node (1 proc) | Node (8-worker cluster) |
|---|---|---|---|
| Render-bound req/s | 2 967 | 397 | 1 314 |
| Render-bound p50/p99 | 13/48 ms | 122/242 ms | 35/94 ms |
| Subprocess-bound (`git log`/req) req/s | 127 | 68 | 108 |
| Startup → first response | 47 ms | 623 ms | 737 ms |
| Idle RSS | 5.3 MB | 98 MB | 803 MB total |
| RSS under load | 25 MB | 300 MB | — |
| Build/install | 24 s compile → 1.9 MB static binary | 3 s npm install, 14 MB deps + Node required | — |
| Bare CLI invocation | ~1 ms | 37 ms (114 ms + one framework import) | — |

Interpretation for Navbook: server throughput is irrelevant at team scale;
the decisive numbers are invocation latency and distribution weight (Rust) vs
iteration speed, contributor pool, and a core shared with the web client's
server (TypeScript). Hence: TypeScript while the spec moves, Rust when it
stops moving.
