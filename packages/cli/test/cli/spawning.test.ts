/**
 * How `nav` starts the programs it hands work to — npm and the editor — on
 * each platform.
 *
 * Pure functions of the platform, so every case runs everywhere: a Linux run
 * checks what Windows will be given. Whether Windows then reads it back as
 * intended is the end-to-end tests' to show, where they can run.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasScheme, looksLocal } from "../../src/commands/plugin.ts";
import { editorInvocation, posixShell } from "../../src/editor.ts";
import { npmInvocation } from "../../src/plugins/store.ts";

describe("npmInvocation", () => {
  it("runs npm itself, arguments untouched, where npm is a program", () => {
    for (const platform of ["linux", "darwin"] as const) {
      assert.deepEqual(npmInvocation(["install", "a b&c"], platform), {
        file: "npm",
        args: ["install", "a b&c"],
        verbatim: false,
      });
    }
  });

  it("hands Windows one cmd.exe command line, every argument quoted", () => {
    const run = npmInvocation(["install", "--save-exact", "plain"], "win32", "cmd.exe");
    assert.equal(run.file, "cmd.exe");
    assert.equal(run.verbatim, true, "Node must not quote it a second time");
    assert.deepEqual(run.args.slice(0, 3), ["/d", "/s", "/c"]);
    // `"` is itself a character cmd escapes, twice: once for the line, once
    // more for the batch file reading `%*`.
    assert.equal(run.args[3], '"npm ^^^"install^^^" ^^^"--save-exact^^^" ^^^"plain^^^""');
  });

  it("runs the command interpreter %ComSpec% names, as cross-spawn does", () => {
    const comspec = "C:\\Windows\\System32\\cmd.exe";
    assert.equal(npmInvocation(["install"], "win32", comspec).file, comspec);
  });

  it("escapes what cmd.exe would act on, and doubles backslashes before a quote", () => {
    const args = ["a&b", "100%", 'say "hi"\\', "C:\\dir\\"];
    const [, , , line = ""] = npmInvocation(args, "win32").args;
    // Each special character carries two escapes, so none of them is live:
    // `&`, `%`, a space and a quote alike.
    assert.ok(line.includes(`^^^"a^^^&b^^^"`), line);
    assert.ok(line.includes(`^^^"100^^^%^^^"`), line);
    // A quote inside is escaped for the C runtime too, and a backslash before
    // the closing quote is doubled, so the program gets back what it was given.
    assert.ok(line.includes(String.raw`^^^"say^^^ \^^^"hi\^^^"\\^^^"`), line);
    assert.ok(line.includes(String.raw`^^^"C:\dir\\^^^"`), line);
  });
});

describe("editorInvocation", () => {
  it("runs the editor the way git does, the path an argument of its own", () => {
    assert.deepEqual(editorInvocation("code -w", "/tmp/it's here.md", "/bin/sh"), {
      file: "/bin/sh",
      args: ["-c", 'code -w "$@"', "code -w", "/tmp/it's here.md"],
      shell: false,
    });
  });

  it("falls back to Windows's own shell, the path in double quotes", () => {
    assert.deepEqual(editorInvocation("notepad", "C:\\Users\\A B\\x.md", null), {
      file: 'notepad "C:\\Users\\A B\\x.md"',
      args: [],
      shell: true,
    });
  });

  it("finds a POSIX shell wherever git came with one", () => {
    assert.equal(posixShell("linux"), "/bin/sh");
    assert.equal(posixShell("darwin"), "/bin/sh");
    if (process.platform === "win32") {
      // Git for Windows ships the shell it runs editors with.
      assert.match(posixShell("win32") ?? "", /sh\.exe$/);
    }
  });
});

describe("what nav plugin install takes for a path or a URL", () => {
  it("reads a URL by its scheme, which a drive letter is not", () => {
    for (const spec of ["https://example.com/p.tgz", "git+ssh://host/p.git", "github:a/b"]) {
      assert.equal(hasScheme(spec), true, spec);
    }
    for (const spec of ["C:\\plugins\\probe", "c:/plugins/probe", "file:../probe", "probe"]) {
      assert.equal(hasScheme(spec), false, spec);
    }
  });

  it("takes an absolute path by the platform's own rules", () => {
    for (const spec of ["C:\\plugins\\probe", "c:/plugins/probe", "\\\\server\\share\\probe"]) {
      assert.equal(looksLocal(spec, "win32"), true, spec);
      assert.equal(looksLocal(spec, "linux"), false, `${spec} names no file on Linux`);
    }
    for (const platform of ["win32", "linux"] as const) {
      for (const spec of ["/srv/probe", "./probe", "../probe", "file:probe", "p.tgz"]) {
        assert.equal(looksLocal(spec, platform), true, `${spec} on ${platform}`);
      }
      assert.equal(looksLocal("@navbook/plugin-kb@^0.5", platform), false);
    }
  });
});
