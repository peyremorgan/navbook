# Plugins

Navbook's core is issues, pull requests and the format they live in. Everything
else — test reports attached to a pull request, an assistant that helps write a
ticket, a bridge to a chat platform, the knowledge base — is a **plugin**: an
npm package the repository names and each machine installs.

This document is the reference for writing one and the list of the ones that
exist. The normative rules are in the specification: [02
§2.12](spec/02-data-model.md) says where a plugin's data may live in a tree,
and [04 §4.3](spec/04-cli.md) says what `nav plugin` does.

## Using them

A repository says which plugins its tree uses, in `.navbook/navbook.json`:

```json
{
  "version": 1,
  "plugins": {
    "@navbook/plugin-kb": {}
  }
}
```

Every clone then knows what the tree contains — which is the point, because a
`nav` without the knowledge base installed should be able to say why
`.navbook/specs/` means nothing to it rather than quietly ignoring it.

Naming a plugin does not install it. On a fresh clone:

```console
$ nav plugin install
The following plugins are declared but not installed:
  @navbook/plugin-kb
This will run: npm install --ignore-scripts @navbook/plugin-kb
Continue? [y/N]
```

Nothing is fetched or executed because a file in a repository asked for it. The
declaration is data about the tree; installing is a decision you make.

| Command | What it does |
|---|---|
| `nav plugin install` | Install what the repository declares and you lack |
| `nav plugin install <name>...` | Install these, whether or not they are declared |
| `nav plugin list [--json]` | What is installed, and whether this repository declares it |
| `nav plugin update [<name>]` | Update one, or all |
| `nav plugin remove <name>` | Take one out of the store |

Plugins live in a store `nav` owns — `$XDG_DATA_HOME/navbook/plugins`, or
`~/.local/share/navbook/plugins` — so it does not matter how `nav` itself was
installed. `nav plugin list` prints the path.

Settings under a plugin's name in `navbook.json` are committed, shared by
everyone who clones, and therefore never secret. A plugin that needs a
credential reads it from the environment.

## Available plugins

| Plugin | What it adds |
|---|---|
| [`@navbook/plugin-kb`](../packages/plugin-kb/README.md) | The knowledge base: features under `specs/`, the documents that describe them, and the `feature:` key that attaches work to one |

`@navbook/plugin-kb` is also the worked example. It uses every seam a plugin
has — a directory of its own, a frontmatter key, a query term, doctor checks, a
command tree, options on built-in verbs, GraphQL types and resolvers — and its
own suite is the same set of questions the built-in feature suite used to ask.
Reading it beside this document is the fastest way to see what a plugin looks
like when it is finished.

To have one listed here, open a pull request adding a row. There is no registry
to submit to and nothing to approve: the list is what somebody thought worth
pointing at. `npm search keywords:navbook-plugin` finds what is published,
listed here or not.

## Writing one

### The package

A plugin is one npm package, named so that it can be recognised as one:

| Form | Example |
|---|---|
| First-party | `@navbook/plugin-kb` |
| Third-party | `navbook-plugin-jira` |
| Third-party, scoped | `@acme/navbook-plugin-jira` |

and carrying `navbook-plugin` among its `keywords`. Both are checked when it is
installed, so a package that is not a plugin cannot be installed as one.

One package holds every part of the plugin, as `exports` subpaths. A plugin
implements only the parts it needs: a chat bridge is server-only, a listing
column is CLI-only.

| Subpath | Runs in | For |
|---|---|---|
| `./core` | every front end | format: files, frontmatter keys, query terms, doctor checks |
| `./cli` | `nav` | commands, options, columns, completions |
| `./server` | `nav-server` | GraphQL schema and resolvers, background services |
| `./web` | the web build | a Nuxt layer: pages, components, slots |

```json
{
  "name": "@navbook/plugin-kb",
  "keywords": ["navbook-plugin"],
  "peerDependencies": { "@navbook/core": "^0.4.0" },
  "engines": { "node": ">=24", "navbook": "^1.0.0" },
  "exports": {
    "./core": "./src/core/index.ts",
    "./cli": "./src/cli/index.ts",
    "./server": "./src/server/index.ts",
    "./web": "./web/nuxt.config.ts"
  },
  "navbook": { "short": "kb" }
}
```

`@navbook/core` is a **peer** dependency, and for types only. At runtime a
plugin is handed the core its host is already running, because two copies would
mean two class identities for the same error and two YAML parsers on the
startup path. `engines.navbook` is the plugin API version the plugin was built
against; a host that does not satisfy it says so and skips the plugin rather
than failing somewhere deeper.

### The manifest

The `navbook` key of `package.json` declares what the plugin contributes. This
is the part that makes plugins affordable: a host builds its command tree, its
help and its completions from the manifest alone, and imports a plugin's code
only when one of the things it declared actually runs. `nav issue list` costs
the same with ten plugins installed as with none.

```json
{
  "navbook": {
    "short": "kb",
    "spec": "doc/spec.md",
    "format": {
      "root": ["specs"],
      "frontmatterKeys": ["feature"]
    },
    "core": {
      "queryKeys": [
        { "key": "feature", "kinds": ["issue", "pr"], "help": "feature:SLUG   work attached to a feature" }
      ],
      "doctorChecks": [
        { "id": "X-kb-1", "level": "error", "description": "the layout and schema of specs/" }
      ],
      "commitScopes": ["feature"]
    },
    "cli": {
      "commands": [
        { "name": "feature", "description": "work with features", "commands": [ "..." ] }
      ],
      "contributions": [
        { "on": "issue open", "options": [
          { "flags": "--feature <slug>", "description": "attach it to a feature", "repeatable": true }
        ] }
      ]
    },
    "server": { "schema": "server/schema.graphql" },
    "web": true
  }
}
```

**`short`** is the plugin's one-word name, matching `^[a-z][a-z0-9]*$`. It is
what its namespaces are named after: a `<short>/` directory, `<short>-*`
frontmatter keys, `X-<short>-<n>` doctor checks, `NAV_SERVER_<SHORT>_*`
configuration.

**`format`** declares the namespaces the plugin's data occupies, and requires
**`spec`**: a document describing that data, in the sense the Navbook
specification is one. A tree is meant to outlive the tool that wrote it, so
data nobody can look up is data nobody can keep.

**`core`**, **`cli`**, **`server`** and **`web`** declare contributions per
host. The full schema is the `PluginManifest` type exported by `@navbook/core`,
which is where to look for the fields this overview omits.

### The code

Each subpath exports `activate(host)`. The host is the running front end: it
carries the core, the plugin's settings from `navbook.json`, and the
registration hooks for that layer.

```ts
// src/core/index.ts
import type { CorePluginHost } from "@navbook/core";

export function activate(host: CorePluginHost): void {
  host.register({
    treeLocations: [{ dir: "specs", build: readFeatures }],
    queryKeys: [{ key: "feature", kinds: ["issue", "pr"], matches: entityHasFeature }],
    doctorChecks: [{ id: "X-kb-1", level: "error", run: checkSpecsLayout }],
  });
}
```

A mutation returns a `Plan` — the same file-operations-plus-commit-message
value every built-in verb produces — and hands it to `runPlan`. That is not a
formality: it is how a plugin's changes get `--commit`, the staged-changes
guard and the commit message conventions without implementing any of them.

On the server, a resolver reads the tree through the request's context rather
than parsing it itself, so that every field of a request — and every request
since the tree last changed — shares one parse:

- a root field reads inside `ctx.sync.read(() => …)`, which brings the clone
  up to date first, and takes the tree from `ctx.loadRepo(scope)`, where
  `scope` names whose comments it needs: `"none"`, `"prs"` or `"all"`;
- a field beneath one reads `await ctx.repo()`, the tree its parent read;
- an entity read without its comments answers them through
  `await ctx.commented(entity)`.

A root field that used `ctx.repo()` alone would answer from whatever the clone
last fetched, and miss what somebody pushed a moment ago.

### The web half

`./web` is a [Nuxt layer](https://nuxt.com/docs/getting-started/layers): a
directory whose `nuxt.config.ts` the client `extends`. Its `app/pages` become
routes, its `app/components` and `app/composables` are auto-imported, and that
is the whole of what it takes to add a page.

Two things follow from a layer being a *build-time* thing, and both are
surprising enough to be worth stating:

- Which plugins a client carries is decided when the bundle is built, not when
  the container starts. `NAVBOOK_WEB_PLUGINS` is that list, and `.env`'s
  `NAVBOOK_PLUGINS` sets it for both images at once so the API and the client
  cannot disagree about what exists.
- Inside a layer, `~/…` resolves against the *consuming* project, not the
  layer. So `~/utils/patch` is the host's, and a layer's own modules are
  imported by relative path.

Anything a plugin wants that is not a page of its own goes through the slot
registry, which a layer fills from one of its own Nuxt plugin files:

```ts
// web/app/plugins/50.kb.ts
export default defineNuxtPlugin({
  name: "navbook-plugin-kb",
  enforce: "pre",
  setup() {
    useNavbookSlots().register({
      navLinks: [{ label: "Features", to: "/features", icon: "i-lucide-layers" }],
      panels: [{ noun: "issue", component: KbFeaturePanel }],
      entityFields: [{ field: "features", label: "features", read: readKbFeatures }],
      rowBadges: [{ component: KbFeatureChips }],
      filters: [{ param: "feature", apiField: "features", /* … */ }],
      inboxGroups: [{ key: "feature", label: "Feature", /* … */ }],
      cache: { typePolicies: { Feature: { keyFields: ["slug"] } } },
    });
  },
});
```

**`Entity.ext` is how a plugin draws on somebody else's row.** A plugin's SDL
extends `Issue`, but nothing extends a *fragment* — and the host's list-row
fragment is written in `@navbook/web`, which has never heard of your field. So
the host selects one map, `ext`, and every loaded plugin fills its own key
under its short name. A row badge reads `entity.ext.<short>`; a query the
plugin writes itself asks for the typed field as usual. The server side is one
call:

```ts
host.entityExt((entity) => ({ features: readFeatures(entity.fm) }));
```

Read it defensively. `ext` is a `JSON` scalar, so a client built with your
layer against an API without your plugin gets no key at all — and that has to
render as "nothing to show" rather than as a page that will not load.

A plugin's own operations are generated against the *composed* schema: its
`codegen.ts` reads `@navbook/server`'s SDL and its own, and generates into its
own package. That is what keeps `@navbook/web` buildable with no plugins
installed, and it is why a fragment cannot be shared across the boundary — a
document registry does not cross a package, so a selection the host also makes
is written out again on the plugin's side.

### What loading costs, and when it happens

A plugin's code is imported only when something it declared is actually
reached. Four things do that, and nothing else:

| What you type | What loads |
|---|---|
| `nav --help`, `nav issue list` | nothing |
| `nav <plugin-noun> …` | that plugin's `./core` and `./cli` |
| a verb a plugin contributes to | that plugin's `./core` and `./cli` |
| a query term a plugin declared | that plugin's `./core` |
| `nav doctor` | every plugin's `./core`, to run its checks |

So a contribution is a bargain you make openly: a column on `issue list` means
that listing loads the plugin, because the column cannot be drawn without it. A
plugin that contributes nothing to a command costs that command nothing at all
— measured, not assumed, by the performance suite.

A command that reads no tree can say so with `"needsCore": false`, and then
even its own plugin's format half stays unloaded.

### Developing one

`NAVBOOK_PLUGIN_PATH` is a colon-separated list of directories, each a plugin
package, loaded ahead of the store — so a plugin you are writing shadows an
installed copy of itself. Nothing has to be installed or published:

```console
$ NAVBOOK_PLUGIN_PATH=~/code/navbook-plugin-jira nav jira sync
```

`packages/cli/test/fixtures/plugin-probe` in this repository is a complete
worked example: one noun with two verbs, an option on `issue open`, a column
and a `--json` key on `issue list`, a section on `issue show`, a query term, a
tree location and a doctor check, in about a hundred lines.

The web part is a Nuxt layer merged at build time, so the client is built with
the plugins it is meant to have:

```console
$ NAVBOOK_WEB_PLUGINS="@navbook/plugin-kb" pnpm --filter @navbook/web build
```

Changing which plugins a deployment has is therefore a rebuild rather than a
restart — the one thing in a Navbook deployment that works that way, because a
browser bundle is decided when it is built. In `docker compose`, set
`NAVBOOK_PLUGINS` in `.env` and run `docker compose build`.
