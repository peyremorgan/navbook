/**
 * How the binary is invoked.
 *
 * npm installs `nav` as a symlink in `node_modules/.bin`, so the entry point
 * must recognise itself through that link. Getting this wrong makes the
 * installed CLI exit 0 having done nothing — silently, which is the worst way
 * for a packaging bug to behave.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CLI_ENTRY, navCommand } from "../helpers/temprepo.ts";

/** The file the `nav` bin entry points at, whether source or build. */
function entryPath(): string {
  const command = navCommand();
  return command[command.length - 1] as string;
}

describe("the nav entry point", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "navbook-bin-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const runNav = (
    executable: string,
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [executable, "--version"], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  it("runs when invoked by its real path", () => {
    const result = runNav(entryPath());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });

  it("runs when invoked through a symlink, as npm installs it", () => {
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    const link = join(binDir, "nav");
    symlinkSync(entryPath(), link);

    const result = runNav(link);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^\d+\.\d+\.\d+/,
      "a silent exit 0 means the entry point did nothing",
    );
  });

  it("runs through a symlink to a symlink, as a global install can produce", () => {
    const first = join(dir, "first-nav");
    const second = join(dir, "second-nav");
    symlinkSync(entryPath(), first);
    symlinkSync(first, second);

    const result = runNav(second);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });

  it("does not run its command tree when imported as a module", () => {
    const importer = join(dir, "importer.mjs");
    const target = CLI_ENTRY;
    const script = `import { run } from ${JSON.stringify(target)};\nconsole.log("imported", typeof run);\n`;
    writeFileSync(importer, script, "utf8");

    const result = spawnSync(process.execPath, [importer], {
      encoding: "utf8",
      cwd: dirname(target),
    });
    assert.equal(result.status, 0, result.stderr ?? "");
    assert.equal(
      (result.stdout ?? "").trim(),
      "imported function",
      "importing must not execute the CLI",
    );
  });
});
