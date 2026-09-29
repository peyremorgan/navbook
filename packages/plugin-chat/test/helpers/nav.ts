/**
 * `nav`, run without blocking the test process.
 *
 * The CLI suite's `repo.nav` is `spawnSync`, which would hold the event loop
 * the stub model endpoint answers on: the command would wait for the model
 * and the model for the command. So this spawns asynchronously, with the same
 * command and the same deterministic environment.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicEnv, navCommand, type TempRepo } from "@navbook/cli/test-helpers";

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface NavResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `nav` in `repo` with the plugin on the path, feeding `input` to stdin. */
export function nav(
  repo: TempRepo,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
  input = "",
): Promise<NavResult> {
  const [command, ...leading] = navCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command as string, [...leading, ...args], {
      cwd: repo.dir,
      env: { ...deterministicEnv(repo.home), NAVBOOK_PLUGIN_PATH: PLUGIN, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}
