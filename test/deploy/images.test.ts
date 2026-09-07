/**
 * That the Dockerfiles still describe this repository.
 *
 * A build context is a set of paths and a set of versions, and both are written
 * down twice: once where they live and once in a `COPY` or a `FROM`. A rename
 * or a bump breaks the image and nothing local says so — the build is the first
 * thing that fails, and only where there is a Docker to run it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
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

  it("gives the API image the git it shells out to for every read and write", () => {
    assert.match(read(DOCKERFILES.api), /apk add --no-cache .*\bgit\b/);
  });
});
