# @navbook/web

The browser interface to Navbook — a thin client of the
[`@navbook/server`](../server) GraphQL API
([spec 06 §6.3](../../doc/spec/06-future.md)).

It is a static single-page app. `nuxi generate` emits a shell that any file
server can hand out, and every byte of data comes from the API at runtime.
Nothing about the format is reimplemented here and no Navbook logic ships to
the browser: the client sends fields, and the server composes the files.

The audience is everyone on a project who is not working from a checkout.
Filing an issue, commenting and reviewing do not need a terminal — but the
commit still happens, on the signed-in person's behalf, in a real repository.

## What it does

**Issues**, in full: a filtered listing, the detail with its comments and the
tree of subtasks beneath it, filing, editing in place, closing with a
resolution, reopening, commenting and replying, and linking or unlinking
subtasks.

**Pull requests**, read and reviewed: the listing, with a toggle for the
branches this checkout does not hold; the detail with its target, source,
revisions and merge; and comments or reviews bound to a revision.

Opening, updating and merging a pull request are not here, and neither is
deleting anything. They are checkout-centric maintainer actions and the API
does not expose them ([server README](../server/README.md#what-it-does-not-do)).

## Running it while developing

```sh
pnpm --filter @navbook/web dev:stack
```

That starts three things: a development OIDC provider on port 9000, a
`nav-server` on 4000 serving a throwaway repository, and Vite on 3000. Open
<http://localhost:3000>, and sign in as anybody — the address you give is what
every issue and comment will record as its author.

The repository is built under the system temporary directory and kept between
runs, so what you filed yesterday is still there. `--fresh` rebuilds it. It is
emphatically not the repository you are standing in: every mutation commits,
and a stray click should not file an issue against Navbook itself.

To run the three by hand instead:

```sh
node script/dev-issuer.ts --port 9000
nav-server --repo /path/to/a/clone --port 4000 \
  --oidc-issuer http://localhost:9000 --oidc-audience navbook
pnpm --filter @navbook/web dev
```

`script/dev-issuer.ts` is a development tool and nothing else: there is no
client secret, no consent and no user database, so anyone may be anyone. It
exists because authentication has no off switch — every operation the API
answers, read or write, needs a token — and `nuxi dev` needs something to log
into. It is grown from the server suite's stub issuer and keeps its shape, so
both exercise the real verification path rather than a bypass.

## Deploying it

```sh
pnpm --filter @navbook/web build      # nuxi generate → .output/public
```

Copy `.output/public` to any static host, then **overwrite `config.json`** with
the addresses that deployment uses:

```json
{
  "graphqlUrl": "https://navbook.example.com/graphql",
  "oidc": {
    "issuer": "https://accounts.example.com",
    "clientId": "navbook-web",
    "audience": "navbook"
  }
}
```

The address of the API cannot be compiled in, because one built artefact has to
serve every deployment. It is read from that file at boot, and a file that is
missing or wrong is a fatal error naming the key, rather than a fetch to
`undefined/graphql` three screens later.

Two things the host has to do:

- **Serve `200.html` for unknown paths.** Routing happens in the browser, so a
  reload on `/issues/ab12cd34` has to reach the app rather than a 404. That is
  what the SPA fallback `nuxi generate` emits is for.
- **Nothing about CORS.** The API answers any origin with an `Authorization`
  header, so the app and the server need not share one.

What the identity provider has to do:

- **Mint JWT access tokens**, not opaque ones, since the server verifies the
  token itself against the issuer's JWKS.
- **Put the audience in them.** The app asks for it, and the server checks it.
- **Include an `email` claim.** It is the identity: `author:` records it, so an
  issuer that lets somebody set an unverified address lets them author as that
  person ([server README](../server/README.md#deploying-it)).
- **Issue refresh tokens** (`offline_access`), because renewal uses them. The
  hidden-iframe alternative depends on third-party cookies browsers no longer
  send.

Authorization is out of scope here as it is on the server: any token the issuer
signs for this audience may write. Put the policy you need in front.

## Development

```sh
pnpm --filter @navbook/web test        # the unit suite; also runs in `pnpm test`
pnpm --filter @navbook/web test:e2e    # Playwright, against a real stack
pnpm --filter @navbook/web typecheck
pnpm --filter @navbook/web codegen     # after packages/server/schema.graphql changes
```

`src/generated/gql/` is generated from `packages/server/schema.graphql` — read
from the server package rather than copied, so there is one contract — and is
committed and checked in CI, exactly as the server's resolver types are.

The end-to-end suite needs a built bundle (`pnpm --filter @navbook/web build`)
and Chromium (`pnpm --filter @navbook/web exec playwright install chromium`).
It starts an issuer, a `nav-server` and a fixture repository with an origin to
push to, and serves the generated bundle rather than a dev server, because that
is what gets deployed. Nothing in it is mocked: the point is to prove that a
browser, an OIDC flow, a GraphQL API and a git repository work together.

Unit tests are split by which type check should cover them. `test/nuxt/` is
what Nuxt's generated `tsconfig.app.json` checks alongside `app/`; `test/node/`
is checked by `tsconfig.tools.json` and holds the tests for the development
scripts, which never reach the browser.

`script/fixture-repo.ts` is the only file here that imports `@navbook/core`,
and it may because it never reaches the browser either: it stands in for the
person who would otherwise have run `nav` a dozen times.
