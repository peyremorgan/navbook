/**
 * That the Dockerfiles still describe this repository.
 *
 * A build context is a set of paths and a set of versions, and both are written
 * down twice: once where they live and once in a `COPY` or a `FROM`. A rename
 * or a bump breaks the image and nothing local says so — the build is the first
 * thing that fails, and only where there is a Docker to run it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";
import { ENTRYPOINT, WEB_CONFIG_SCRIPT } from "./helpers.ts";

const DOCKERFILES = {
  api: "packages/server/Dockerfile",
  web: "packages/web/Dockerfile",
};

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/** Instructions, with continuations joined, so a wrapped `COPY` reads as one. */
function instructions(dockerfile: string): string[] {
  return read(dockerfile)
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** The paths a `COPY` takes from the build context, so not the ones `--from` a stage. */
function copiedFromContext(dockerfile: string): string[] {
  const sources: string[] = [];
  for (const line of instructions(dockerfile)) {
    if (!/^COPY\s/i.test(line)) continue;
    const parts = line.split(/\s+/).slice(1);
    if (parts.some((part) => part.startsWith("--from="))) continue;
    // The last is the destination; flags are not paths.
    sources.push(...parts.slice(0, -1).filter((part) => !part.startsWith("--")));
  }
  return sources;
}

/**
 * Whether `.dockerignore` keeps a path out of the context.
 *
 * Only the shapes this file actually uses: an exact path, a parent directory,
 * and the `**' + '/name` form. Enough to catch the mistake worth catching, which is
 * excluding a directory a build copies from.
 */
function excluded(path: string): string | null {
  const patterns = read(".dockerignore")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const segments = path.split("/");

  for (const pattern of patterns) {
    if (pattern.startsWith("**/")) {
      if (segments.includes(pattern.slice(3))) return pattern;
      continue;
    }
    if (pattern === path) return pattern;
    if (path.startsWith(`${pattern}/`)) return pattern;
  }
  return null;
}

interface Workspace {
  /** Package name to its directory, as `packages/<dir>`. */
  dirs: Map<string, string>;
  /** Package name to the workspace packages it names in any dependency field. */
  deps: Map<string, string[]>;
}

/**
 * The workspace's packages, from the globs `pnpm-workspace.yaml` lists.
 *
 * Only the shapes a glob there takes today — `dir/*` and a plain path — and a
 * refusal of any other, so a new shape fails here rather than leaving packages
 * out of what the tests below check.
 */
function workspaceDirs(): string[] {
  const globs = (parseYaml(read("pnpm-workspace.yaml")) as { packages?: string[] }).packages ?? [];
  return globs.flatMap((glob) => {
    if (/^[\w.-]+(\/[\w.-]+)*\/\*$/.test(glob)) {
      const parent = glob.slice(0, -2);
      return readdirSync(join(REPO_ROOT, parent)).map((dir) => `${parent}/${dir}`);
    }
    assert.match(
      glob,
      /^[\w.-]+(\/[\w.-]+)*$/,
      `pnpm-workspace.yaml glob '${glob}' is not read here`,
    );
    return [glob];
  });
}

function workspace(): Workspace {
  const dirs = new Map<string, string>();
  const manifests = new Map<string, Record<string, Record<string, string> | undefined>>();
  for (const dir of workspaceDirs()) {
    const path = `${dir}/package.json`;
    if (!existsSync(join(REPO_ROOT, path))) continue;
    const manifest = JSON.parse(read(path));
    dirs.set(manifest.name, dir);
    manifests.set(manifest.name, manifest);
  }
  const deps = new Map<string, string[]>();
  for (const [name, manifest] of manifests) {
    const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const named = fields.flatMap((field) => Object.entries(manifest[field] ?? {}));
    // A `workspace:` dependency that is not a package found above means the
    // globs were misread, and dropping it would hide exactly what is checked.
    for (const [dep, range] of named) {
      if (range.startsWith("workspace:")) {
        assert.ok(dirs.has(dep), `${name} depends on ${dep}, which no workspace glob finds`);
      }
    }
    deps.set(name, [...new Set(named.map(([dep]) => dep).filter((dep) => dirs.has(dep)))]);
  }
  return { dirs, deps };
}

/** The package and every workspace package it depends on, as pnpm's `name...` selects. */
function closure(ws: Workspace, name: string): Set<string> {
  const seen = new Set<string>();
  const queue = [name];
  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(ws.deps.get(next) ?? []));
  }
  return seen;
}

/** The API build stage's install, as the packages it selects. */
function installed(ws: Workspace, dockerfile: string): Set<string> {
  const install = instructions(dockerfile).find((line) => /^RUN pnpm install\s/.test(line));
  assert.ok(install, `${dockerfile} has no pnpm install`);
  const selected = new Set<string>();
  for (const [, filter = ""] of install.matchAll(/--filter(?:\s+|=)"?([^"\s]+)"?/g)) {
    const name = filter.replace(/\.\.\.$/, "");
    // `name` and `name...` only: a path, a `{dir}` or a `^...` selector would
    // be read here as a name and checked against a selection pnpm never makes.
    assert.ok(
      name === "navbook-workspace" || ws.dirs.has(name),
      `${dockerfile}: the filter '${filter}' is not a selector this test reads`,
    );
    for (const pkg of filter.endsWith("...") ? closure(ws, name) : [name]) selected.add(pkg);
  }
  return selected;
}

/** The packages the build stage packs into tarballs. */
function packed(dockerfile: string): string[] {
  return [...read(dockerfile).matchAll(/pnpm --filter (\S+) pack\b/g)].map(
    (match) => match[1] as string,
  );
}

describe("the Dockerfiles", () => {
  for (const [image, dockerfile] of Object.entries(DOCKERFILES)) {
    it(`copies only paths this repository has, into the ${image} image`, () => {
      const missing = copiedFromContext(dockerfile).filter(
        (source) => !existsSync(join(REPO_ROOT, source)),
      );

      assert.deepEqual(missing, [], `${dockerfile} copies something that is not here`);
    });

    it(`copies nothing .dockerignore keeps out, into the ${image} image`, () => {
      const kept = copiedFromContext(dockerfile)
        .map((source) => [source, excluded(source)] as const)
        .filter(([, pattern]) => pattern !== null)
        .map(([source, pattern]) => `${source} (by '${pattern}')`);

      assert.deepEqual(kept, [], `${dockerfile} copies what the context excludes`);
    });

    it(`builds the ${image} image on a Node the workspace supports`, () => {
      const from = /^FROM node:(\d+)-alpine/im.exec(read(dockerfile));
      assert.ok(from, `${dockerfile} does not build on a node image`);

      const engines = JSON.parse(read("package.json")).engines.node as string;
      const least = Number(/(\d+)/.exec(engines)?.[1]);
      assert.ok(
        Number(from[1]) >= least,
        `${dockerfile} builds on node ${from[1]}, and the workspace wants ${engines}`,
      );
    });

    it(`installs the pnpm the workspace names, for the ${image} image`, () => {
      const pinned = /npm install -g pnpm@(\S+)/.exec(read(dockerfile))?.[1];
      const declared = (JSON.parse(read("package.json")).packageManager as string).replace(
        "pnpm@",
        "",
      );

      assert.equal(pinned, declared, `${dockerfile} pins a different pnpm than package.json`);
    });
  }

  it("installs the dependencies of every package the API image packs", () => {
    // `pack` runs `prepack`, which compiles against them. plugin-kb depends on
    // the server rather than the other way round, so selecting the server
    // with its dependencies never installed it (#uniyh2hy).
    const ws = workspace();
    const selected = installed(ws, DOCKERFILES.api);
    const packs = packed(DOCKERFILES.api);
    assert.ok(packs.length > 0, "the API image packs nothing");

    const missing = packs.flatMap((name) =>
      [...closure(ws, name)]
        .filter((pkg) => !selected.has(pkg))
        .map((pkg) => `${pkg} (for ${name})`),
    );
    assert.deepEqual(
      missing,
      [],
      "the build stage's install leaves out what a pack compiles against",
    );
  });

  it("copies the sources of everything a packed package compiles against", () => {
    // A manifest is enough for the lockfile, not for `tsc`: in the workspace a
    // package's exports are its TypeScript sources, so plugin-kb's
    // `@navbook/cli/plugin` needs cli's whole directory (#uniyh2hy).
    const ws = workspace();
    const copied = new Set(copiedFromContext(DOCKERFILES.api));

    // The whole directory, or its `src/` beside the manifest copied earlier:
    // what `tsc` reads through a workspace package's exports is its source.
    const missing = new Set(
      packed(DOCKERFILES.api)
        .flatMap((name) => [...closure(ws, name)])
        .map((pkg) => ws.dirs.get(pkg) as string)
        .filter((dir) => !copied.has(dir) && !copied.has(`${dir}/src`)),
    );
    assert.deepEqual(
      [...missing],
      [],
      "the build stage copies only the manifest of a package tsc reads",
    );
  });

  it("installs plugins as the CLI store does, and checks their core range itself", () => {
    // Without `--legacy-peer-deps` npm refuses plugin-kb over its web half's
    // optional peers (#uniyh2hy); with it, npm no longer checks a plugin's
    // `@navbook/core` range, so the image must.
    const install = instructions(DOCKERFILES.api).find((line) =>
      /npm install --omit=dev/.test(line),
    );
    assert.ok(install, "the API image has no runtime npm install");
    assert.match(install, /--legacy-peer-deps/);
    assert.match(install, /&& node check-plugin-peers\.mjs/);
    assert.ok(existsSync(join(REPO_ROOT, "packages/server/docker/check-plugin-peers.mjs")));
  });

  it("installs a workspace plugin from its tarball, and anything else as written", () => {
    // The Dockerfile's own loop, run in `sh` beside stand-in tarballs.
    const install = instructions(DOCKERFILES.api).find((line) =>
      /for spec in \$NAVBOOK_PLUGINS/.test(line),
    );
    assert.ok(install, "the API image has no NAVBOOK_PLUGINS loop");
    const loop = /(for spec in \$NAVBOOK_PLUGINS;.*?\bdone)\s+&&/.exec(install)?.[1];
    assert.ok(loop, "the loop could not be read out of the RUN");
    const dir = mkdtempSync(join(tmpdir(), "navbook-plugin-loop-"));
    try {
      for (const file of ["navbook-core-0.5.0.tgz", "navbook-plugin-kb-0.5.0.tgz"]) {
        writeFileSync(join(dir, file), "");
      }
      const plugins = [
        "@navbook/plugin-kb",
        "@navbook/plugin-kb@^0.5",
        "@navbook/plugin-foo",
        "navbook-plugin-jira@^2",
        "@acme/navbook-plugin-x@1.2.0",
      ];
      const run = spawnSync("sh", ["-c", `${loop}; printf '%s\\n' "$@"`], {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: process.env.PATH, NAVBOOK_PLUGINS: plugins.join(" ") },
      });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(run.stdout.trim().split("\n"), [
        "./navbook-plugin-kb-0.5.0.tgz",
        "./navbook-plugin-kb-0.5.0.tgz",
        "@navbook/plugin-foo",
        "navbook-plugin-jira@^2",
        "@acme/navbook-plugin-x@1.2.0",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies the very scripts the rest of these tests run", () => {
    const relative = (absolute: string) => absolute.slice(REPO_ROOT.length + 1);

    assert.ok(
      copiedFromContext(DOCKERFILES.api).includes(relative(ENTRYPOINT)),
      "the API image does not copy the entrypoint under test",
    );
    assert.ok(
      copiedFromContext(DOCKERFILES.web).includes(relative(WEB_CONFIG_SCRIPT)),
      "the web image does not copy the start-up script under test",
    );
  });

  it("serves the directory nuxi generate actually writes", () => {
    assert.match(read(DOCKERFILES.web), /\.output\/public/);
    assert.match(read("packages/web/nuxt.config.ts"), /preset:\s*"static"/);
  });

  it("leaves a person exec-ing into the API image standing in the clone", () => {
    const workdirs = instructions(DOCKERFILES.api)
      .filter((line) => /^WORKDIR\s/i.test(line))
      .map((line) => line.split(/\s+/)[1]);
    const entrypointDefault = /^repo=\$\{NAV_SERVER_REPO:-(\S+)\}/m.exec(
      readFileSync(ENTRYPOINT, "utf8"),
    )?.[1];

    assert.equal(workdirs.at(-1), entrypointDefault);
  });

  it("gives the API image the git it shells out to for every read and write", () => {
    assert.match(read(DOCKERFILES.api), /apk add --no-cache .*\bgit\b/);
  });

  it("starts the API under an init that reaps what git leaves behind", () => {
    // Why, in the Dockerfile's comment above the ENTRYPOINT and in #rcsql1v9.
    assert.match(read(DOCKERFILES.api), /apk add --no-cache .*\btini\b/);

    const entrypoint =
      instructions(DOCKERFILES.api)
        .findLast((line) => /^ENTRYPOINT\s/i.test(line))
        ?.replace(/^ENTRYPOINT\s+/i, "") ?? "";
    assert.ok(entrypoint.startsWith("["), "the API ENTRYPOINT is not in exec form");
    const argv = JSON.parse(entrypoint) as string[];
    assert.equal(argv[0], "/sbin/tini", "the API image does not start through tini");
    assert.ok(argv.includes("-s"), "tini is not a subreaper, so it reaps nothing when not PID 1");
    assert.equal(argv.at(-1), "/entrypoint.sh", "tini does not hand over to the entrypoint");
  });
});
