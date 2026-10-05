/**
 * That the deployment's three descriptions of itself agree.
 *
 * A key lives in three places at once: `.env.example` documents it, the compose
 * file maps it onto what an image reads, and a shell script inside the image
 * reads it. Nothing but a test notices when one of the three is edited and the
 * others are not — the symptom is a container that starts and then behaves as
 * though a value were never set.
 */

import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";

const COMPOSE_FILE = join(REPO_ROOT, "compose.yaml");
const ENV_EXAMPLE = join(REPO_ROOT, ".env.example");

const composeText = readFileSync(COMPOSE_FILE, "utf8");
const compose = parseYaml(composeText) as {
  services: Record<
    string,
    {
      environment?: Record<string, string>;
      labels?: Record<string, string>;
      build?: { args?: Record<string, string> };
      entrypoint?: unknown;
      stop_grace_period?: string;
    }
  >;
  networks: Record<string, { external?: boolean; name?: string }>;
  volumes: Record<string, unknown>;
};

/**
 * The variables `.env.example` defines, and what it defines them as.
 *
 * Deliberately not a dotenv library: the file is the contract, and reading it
 * with three lines of regular expression is the same three lines a person
 * reading it applies.
 */
function documentedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) keys.set(match[1] as string, match[2] as string);
  }
  return keys;
}

/**
 * The keys `.env.example` marks as required, by the comment above them.
 *
 * A comment block applies to every key that follows it without a blank line in
 * between, which is how the two halves of an identity share one explanation.
 */
function keysDocumentedRequired(): Set<string> {
  const required = new Set<string>();
  let block = "";
  for (const line of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      block += ` ${trimmed}`;
      continue;
    }
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(trimmed)?.[1];
    if (key !== undefined) {
      if (/\brequired\b/.test(block)) required.add(key);
      continue;
    }
    block = "";
  }
  return required;
}

/** Every `${NAVBOOK_…}` the compose file interpolates, and whether it is required. */
function referencedKeys(): Map<string, { required: boolean }> {
  const keys = new Map<string, { required: boolean }>();
  for (const match of composeText.matchAll(/\$\{(NAVBOOK_[A-Z0-9_]*)(:[-?])?/g)) {
    const name = match[1] as string;
    const required = match[2] === ":?";
    keys.set(name, { required: required || (keys.get(name)?.required ?? false) });
  }
  return keys;
}

/** The `NAVBOOK_…` variables a shell script inside an image reads. */
function keysReadBy(script: string): Set<string> {
  const text = readFileSync(join(REPO_ROOT, script), "utf8");
  const names = new Set<string>();
  for (const match of text.matchAll(/\$\{?(NAVBOOK_[A-Z0-9_]*)/g)) names.add(match[1] as string);
  return names;
}

/** Not passed by compose, and should not be: it is how the tests aim the script. */
const TEST_ONLY = new Set(["NAVBOOK_WEB_ROOT"]);

describe("the deployment descriptor", () => {
  it("documents every key it interpolates", () => {
    const documented = documentedKeys();
    const undocumented = [...referencedKeys().keys()].filter((key) => !documented.has(key));

    assert.deepEqual(undocumented, [], "compose.yaml reads keys .env.example never mentions");
  });

  it("interpolates every key it documents", () => {
    const referenced = referencedKeys();
    const unused = [...documentedKeys().keys()].filter((key) => !referenced.has(key));

    assert.deepEqual(unused, [], ".env.example documents keys nothing reads");
  });

  it("builds both images with the same plugin set", () => {
    // The two names differ because the two builds read different variables,
    // but they must come from one value in `.env`: an API carrying a plugin
    // whose web half is missing from the bundle would answer fields nothing
    // renders, and the reverse would render fields nothing answers.
    // Compose's own interpolation, compared as the file writes it.
    const fromEnv = ["$", "{NAVBOOK_PLUGINS:-}"].join("");
    assert.equal(compose.services.api?.build?.args?.NAVBOOK_PLUGINS, fromEnv);
    assert.equal(compose.services.web?.build?.args?.NAVBOOK_WEB_PLUGINS, fromEnv);
  });

  it("lets the build argument reach the web build, even when it is empty", () => {
    // The image sets NAVBOOK_WEB_PLUGINS and runs the package's own `build`
    // script. A script that assigns the variable outright would replace it, and
    // every bundle would carry whatever the script names, whatever `.env` says.
    const web = JSON.parse(readFileSync(join(REPO_ROOT, "packages/web/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const [name, script] of Object.entries(web.scripts)) {
      // One shell word: bare, or double-quoted when its default holds a space.
      const assignment = /^(NAVBOOK_WEB_PLUGINS=(?:"[^"]*"|\S+))\s/.exec(script)?.[1];
      if (assignment === undefined) {
        assert.doesNotMatch(script, /NAVBOOK_WEB_PLUGINS=/, `${name} sets it mid-command`);
        continue;
      }
      for (const value of ["", "@navbook/plugin-kb other-plugin"]) {
        const run: SpawnSyncReturns<string> = spawnSync(
          "sh",
          ["-c", `${assignment} printenv NAVBOOK_WEB_PLUGINS`],
          {
            encoding: "utf8",
            env: { ...process.env, NAVBOOK_WEB_PLUGINS: value },
          },
        );
        assert.equal(
          run.stdout,
          `${value}\n`,
          `${name} replaces NAVBOOK_WEB_PLUGINS=${JSON.stringify(value)}`,
        );
      }
      // Unset, as in a checkout: the script's own default, every workspace plugin.
      const { NAVBOOK_WEB_PLUGINS: _unset, ...without } = process.env;
      const defaulted = spawnSync("sh", ["-c", `${assignment} printenv NAVBOOK_WEB_PLUGINS`], {
        encoding: "utf8",
        env: without,
      });
      assert.equal(
        defaulted.stdout,
        "@navbook/plugin-kb @navbook/plugin-tests @navbook/plugin-chat\n",
        `${name} defaults to the workspace plugins`,
      );
    }
  });

  it("gives every required key a value, so the example renders as it stands", () => {
    const documented = documentedKeys();
    const empty = [...referencedKeys()]
      .filter(([, how]) => how.required)
      .map(([key]) => key)
      .filter((key) => (documented.get(key) ?? "").trim() === "");

    assert.deepEqual(empty, [], "a key compose insists on is left empty in .env.example");
  });

  it("insists on exactly the keys it documents as required", () => {
    const insisted = new Set(
      [...referencedKeys()].filter(([, how]) => how.required).map(([key]) => key),
    );
    const documented = keysDocumentedRequired();

    assert.deepEqual(
      [...insisted].sort(),
      [...documented].sort(),
      "a key is required in one description of the deployment and optional in the other",
    );
  });

  it("passes the API container everything its entrypoint reads", () => {
    const provided = new Set(Object.keys(compose.services.api?.environment ?? {}));
    const missing = [...keysReadBy("packages/server/docker/entrypoint.sh")].filter(
      (key) => !provided.has(key) && !TEST_ONLY.has(key),
    );

    assert.deepEqual(missing, []);
  });

  it("passes the web container everything its start-up script reads", () => {
    const provided = new Set(Object.keys(compose.services.web?.environment ?? {}));
    const missing = [...keysReadBy("packages/web/docker/config.sh")].filter(
      (key) => !provided.has(key) && !TEST_ONLY.has(key),
    );

    assert.deepEqual(missing, []);
  });

  it("configures the server under the names its own README documents", () => {
    const api = Object.keys(compose.services.api?.environment ?? {});

    for (const name of [
      "NAV_SERVER_REPO",
      "NAV_SERVER_OIDC_DISCOVERY_URL",
      "NAV_SERVER_OIDC_AUDIENCE",
      "NAV_SERVER_REQUIRE_CLAIMS",
      "NAV_SERVER_ALLOW_EMAIL_DOMAINS",
      "NAV_SERVER_REQUIRE_EMAIL_VERIFIED",
      "NAV_SERVER_REMOTE",
      "NAV_SERVER_PULL_INTERVAL_MS",
      "NAV_SERVER_GIT_TIMEOUT_MS",
      "NAV_SERVER_MAINTENANCE_INTERVAL_MS",
      "NAV_SERVER_GRAPHIQL",
      "NAV_ROOT",
    ]) {
      assert.ok(api.includes(name), `the API container is never told ${name}`);
    }
  });

  it("tells Traefik the network it is actually on", () => {
    const external = compose.networks.traefik?.name;

    for (const [name, service] of Object.entries(compose.services)) {
      assert.deepEqual(
        service.labels?.["traefik.docker.network"],
        external,
        `${name} advertises a different network than it joins`,
      );
    }
  });

  it("leaves the API image its own entrypoint, the init that reaps git's leftovers", () => {
    // An `entrypoint:` here replaces the image's whole ENTRYPOINT, tini included,
    // and the server would be PID 1 again (#rcsql1v9).
    assert.equal(compose.services.api?.entrypoint, undefined);
  });

  it("gives the API longer to stop than a mutation's fetch and push may take", () => {
    // A stop waits for the mutation in flight, which fetches and then pushes;
    // killing it mid-push is what the grace period is there to avoid.
    const grace = /^(\d+)s$/.exec(compose.services.api?.stop_grace_period ?? "")?.[1];
    assert.ok(grace !== undefined, "the API has no stop_grace_period in whole seconds");
    const timeoutMs = Number(documentedKeys().get("NAVBOOK_GIT_TIMEOUT_MS"));
    assert.ok(timeoutMs > 0, "NAVBOOK_GIT_TIMEOUT_MS has no documented default");
    assert.ok(
      Number(grace) * 1000 > 2 * timeoutMs,
      `a ${grace} s grace period is shorter than a fetch and a push of ${timeoutMs} ms each`,
    );
  });

  it("keeps the clone in a volume, since it is the only durable state there is", () => {
    assert.deepEqual(Object.keys(compose.volumes), ["clone"]);
  });

  it("has the file that holds the token ignored, and the example that does not committed", () => {
    const tracked = (path: string) =>
      spawnSync("git", ["check-ignore", "-q", path], { cwd: REPO_ROOT }).status !== 0;

    assert.equal(tracked(".env"), false, ".env is not ignored, and it holds the token");
    assert.equal(tracked(".env.example"), true, ".env.example is ignored, so nobody gets a start");
  });
});

/** Compose itself, when there is one to ask. CI always has one. */
describe("what compose makes of it", { skip: composeCommand() === null }, () => {
  it("renders against .env.example with no value left to guess", () => {
    const command = composeCommand() as string[];
    const result = spawnSync(
      command[0] as string,
      [...command.slice(1), "--env-file", ".env.example", "config"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const rendered = parseYaml(result.stdout) as {
      services: Record<
        string,
        { environment: Record<string, string>; labels: Record<string, string> }
      >;
    };

    // The one value that is computed rather than copied.
    assert.equal(
      rendered.services.web?.environment.NAVBOOK_GRAPHQL_URL,
      "https://api.navbook.example.com/graphql",
    );
    // Backticks are Traefik's rule syntax, and YAML is an easy place to lose them.
    assert.equal(
      rendered.services.api?.labels["traefik.http.routers.navbook-api.rule"],
      "Host(`api.navbook.example.com`)",
    );
    assert.equal(rendered.services.api?.environment.NAV_SERVER_GRAPHIQL, "false");
  });
});

/** `docker compose`, `docker-compose`, or neither. */
function composeCommand(): string[] | null {
  for (const candidate of [["docker", "compose"], ["docker-compose"]]) {
    const probe = spawnSync(candidate[0] as string, [...candidate.slice(1), "version"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}
