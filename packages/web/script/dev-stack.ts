/**
 * Everything `nuxi dev` needs, in one command.
 *
 * The client is a thin UI over an API server that needs a token for every
 * operation, so developing it means three processes: an identity provider, a
 * `nav-server` with a repository to serve, and Vite. Starting them by hand in
 * three terminals works and is documented in the README; this exists because
 * nobody should have to.
 *
 * The repository is a throwaway under the system temporary directory, kept
 * between runs so the issues you filed while developing are still there
 * tomorrow. It is emphatically not the repository you are standing in: every
 * mutation commits, and a stray click should not file an issue against
 * Navbook itself.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUDIENCE, DEFAULT_CLIENT_ID, startDevIssuer } from "./dev-issuer.ts";
import { createFixtureRepo, SERVED_BRANCH } from "./fixture-repo.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const SERVER_ENTRY = join(PACKAGE_ROOT, "..", "server", "src", "main.ts");

/** Ports `public/config.json` names, so the defaults need no configuration. */
const ISSUER_PORT = 9000;
const API_PORT = 4000;

/** Kept between runs; `--fresh` rebuilds it. */
const REPO_HOME = join(tmpdir(), "navbook-web-dev");

const COLOURS: Record<string, string> = {
  issuer: "\u001b[35m",
  api: "\u001b[36m",
  web: "\u001b[32m",
};
const RESET = "\u001b[0m";

function log(source: string, line: string): void {
  const colour = process.stdout.isTTY ? (COLOURS[source] ?? "") : "";
  const reset = colour === "" ? "" : RESET;
  for (const text of line.split("\n")) {
    if (text.trim() !== "") process.stdout.write(`${colour}${source.padEnd(6)}${reset} ${text}\n`);
  }
}

/** Spawn a child, prefixing everything it says with who said it. */
function run(
  source: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => log(source, chunk));
  child.stderr?.on("data", (chunk: string) => log(source, chunk));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) log(source, `exited with ${code}`);
  });
  return child;
}

async function main(): Promise<void> {
  if (process.argv.includes("--fresh")) rmSync(REPO_HOME, { recursive: true, force: true });

  const clone = join(REPO_HOME, "clone");
  let repoEnv: NodeJS.ProcessEnv = { ...process.env };
  if (existsSync(clone)) {
    log("api", `reusing the repository at ${clone} (--fresh to rebuild it)`);
  } else {
    mkdirSync(REPO_HOME, { recursive: true });
    log("api", `building a repository at ${clone}`);
    const fixture = createFixtureRepo({ root: REPO_HOME });
    // git's identity and the fixture's dates, but this shell's PATH: the
    // server shells out to git and has to be able to find it.
    repoEnv = { ...process.env, ...fixture.env, PATH: process.env.PATH };
  }

  const issuer = await startDevIssuer({ port: ISSUER_PORT, audience: DEFAULT_AUDIENCE });
  // `public/config.json` names localhost, and a token's issuer claim must match
  // the discovery document byte for byte, so the server is told the spelling
  // the browser will use rather than the 127.0.0.1 the socket reports.
  const issuerUrl = `http://localhost:${issuer.port}`;
  log("issuer", `listening on ${issuerUrl} (client ${DEFAULT_CLIENT_ID})`);

  const api = run(
    "api",
    process.execPath,
    [
      SERVER_ENTRY,
      "--repo",
      clone,
      "--port",
      String(API_PORT),
      "--oidc-issuer",
      issuerUrl,
      "--oidc-audience",
      DEFAULT_AUDIENCE,
      "--oidc-jwks-url",
      `${issuerUrl}/jwks`,
      "--pull-interval-ms",
      "2000",
    ],
    repoEnv,
  );

  const web = run(
    "web",
    process.execPath,
    [join(PACKAGE_ROOT, "node_modules", "nuxi", "bin", "nuxi.mjs"), "dev"],
    { ...process.env, NUXT_TELEMETRY_DISABLED: "1" },
  );

  log("web", `the clone is on ${SERVED_BRANCH}; sign in as anyone at the issuer's form`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    for (const child of [api, web]) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
    await issuer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  // One of them dying is the whole stack dying: a client with no API is not
  // something to keep serving.
  for (const child of [api, web]) child.on("exit", () => void stop());
}

await main();
