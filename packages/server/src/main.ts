#!/usr/bin/env node
/**
 * `nav-server` — the entry point.
 *
 * Everything here is what only a process does: reading the environment,
 * printing to a stream, choosing an exit code, and stopping when asked. The
 * server itself is in `server.ts`, so a test can start one without any of it.
 */

import { ConfigError, loadConfig, parseServerArgs, USAGE } from "./config.ts";
import { StartupError, startServer } from "./server.ts";

async function main(argv: readonly string[]): Promise<number> {
  if (parseServerArgs(argv).help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const config = loadConfig(process.env, argv);
  const handle = await startServer({
    config,
    report: (line) => process.stderr.write(`${line}\n`),
  });

  // The readiness line, and the only way to learn the port when 0 was asked
  // for. On stdout because it is the program's output, not a diagnostic.
  process.stdout.write(`nav-server listening on http://localhost:${handle.port}\n`);

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`\nreceived ${signal}, finishing in-flight work\n`);
    handle.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // Resolving here would end the process while the server is still listening.
  return await new Promise<number>(() => undefined);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`nav-server: ${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else if (error instanceof StartupError) {
    process.stderr.write(`nav-server: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`nav-server: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
