/**
 * A plugin reaching the CLI — spec 04 §4.3.
 *
 * The cases that matter most are the negative ones. Half of what makes plugins
 * affordable is what does *not* happen: `nav issue list` with a plugin
 * installed must import nothing, or the startup budget of spec 05 §5.2 is
 * gone. `$PROBE_LOG` is how that is observed — the fixture appends to it the
 * moment either of its entries is imported, so an empty log is proof.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  deterministicEnv,
  makeTempRepo,
  navCommand,
  PACKAGE_ROOT,
  type RunResult,
  type TempRepo,
} from "../helpers/temprepo.ts";

const PROBE = join(PACKAGE_ROOT, "test", "fixtures", "plugin-probe");

/** A repository with the probe on the plugin path, and a log to watch. */
function probeRepo(opts: { declare?: boolean } = {}): TempRepo & { log(): string[] } {
  const repo = makeTempRepo();
  repo.nav(["init"]);
  if (opts.declare !== false) {
    repo.write(
      ".navbook/navbook.json",
      `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-probe": {} } }, null, 2)}\n`,
    );
  }
  const logPath = join(repo.home, "probe.log");
  return Object.assign(repo, {
    log: () =>
      existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean) : [],
    logPath,
  }) as TempRepo & { log(): string[] };
}

/** Environment that puts the probe on the path and points the log at `home`. */
function withProbe(repo: TempRepo): NodeJS.ProcessEnv {
  return { NAVBOOK_PLUGIN_PATH: PROBE, PROBE_LOG: join(repo.home, "probe.log") };
}

/**
 * An npm stand-in on the PATH, with a registry that is a directory.
 *
 * `publish` puts a copy of the probe in it under another version (and, when
 * given, another name). The real npm cannot be used for these: it needs a
 * registry, and what the store records must not depend on the network.
 */
function fakeNpm(repo: TempRepo): {
  env: NodeJS.ProcessEnv;
  publish(version: string, name?: string): string;
  copy(version: string, dir: string): string;
  log(): string[];
} {
  const registry = join(repo.home, "registry");
  const logPath = join(repo.home, "npm.log");
  const copy = (version: string, dir: string, name?: string): string => {
    cpSync(PROBE, dir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    manifest.version = version;
    if (name !== undefined) manifest.name = name;
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
    return dir;
  };
  return {
    env: {
      PATH: `${join(PACKAGE_ROOT, "test", "fixtures", "fake-npm")}:${process.env.PATH}`,
      FAKE_NPM_REGISTRY: registry,
      FAKE_NPM_LOG: logPath,
      PROBE_LOG: join(repo.home, "probe.log"),
    },
    publish: (version, name = "@navbook/plugin-probe") =>
      copy(version, join(registry, name, version), name),
    copy: (version, dir) => copy(version, dir),
    log: () =>
      existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean) : [],
  };
}

/** What `nav plugin list --json` says is installed, by name and version. */
function listed(repo: TempRepo, env: NodeJS.ProcessEnv): string[] {
  return repo
    .nav(["plugin", "list", "--json"], env)
    .stdout.split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { name: string; version: string })
    .map((row) => `${row.name}@${row.version}`);
}

/** The parts of the probe's `package.json` a variant edits. */
interface ProbePackage {
  exports: Record<string, string>;
  navbook: { cli: { contributions: object[] } };
}

/**
 * A copy of the probe with its manifest edited, on the plugin path.
 *
 * For the cases one fixture cannot cover without changing what every other
 * test sees: an extra contribution, a broken entry.
 */
function variantProbe(
  repo: TempRepo,
  edit: (manifest: ProbePackage, dir: string) => void,
): NodeJS.ProcessEnv {
  const dir = join(repo.home, "probe-variant");
  cpSync(PROBE, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  edit(manifest, dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return { NAVBOOK_PLUGIN_PATH: dir, PROBE_LOG: join(repo.home, "probe.log") };
}

/**
 * A probe that also contributes to `pr list`: a `probe` column and a
 * `probeSeen` key, whose JSON also tries `extraJson` on for size.
 */
function prListProbe(repo: TempRepo, extraJson: Record<string, unknown> = {}): NodeJS.ProcessEnv {
  return variantProbe(repo, (manifest, dir) => {
    manifest.navbook.cli.contributions.push({ on: "pr list", columns: true, jsonExtra: true });
    manifest.exports["./cli"] = "./cli-pr.js";
    writeFileSync(
      join(dir, "cli-pr.js"),
      `import { activate as probe } from "./cli.js";
export function activate(host) {
  probe(host);
  host.contribute("pr list", {
    columns: [{ header: "probe", value: () => "seen" }],
    jsonExtra: () => ({ probeSeen: true, ...${JSON.stringify(extraJson)} }),
  });
}
`,
    );
  });
}

/** A pull request opened on `feat/x`, with `main` checked out again. */
function openPrElsewhere(repo: TempRepo, env: NodeJS.ProcessEnv): void {
  repo.commitAll("chore: init");
  repo.git(["checkout", "--quiet", "-b", "feat/x"]);
  repo.write("x.txt", "x\n");
  repo.commitAll("feat: x");
  const opened = repo.nav(["pr", "open", "--title", "X", "-m", "Body.", "--commit"], env);
  assert.equal(opened.code, 0, opened.stderr);
  repo.git(["checkout", "--quiet", "main"]);
}

/** Forget what was logged, so one repository can make several assertions. */
function clearLog(repo: TempRepo): void {
  rmSync(join(repo.home, "probe.log"), { force: true });
}

describe("a plugin's commands", () => {
  it("appear in --help without loading the plugin", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["--help"], withProbe(repo));
      assert.equal(result.code, 0);
      assert.match(result.stdout, /probe\s+the probe plugin's own noun/);
      // The whole point: help is built from the manifest.
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("run, loading the plugin's cli entry", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["probe", "hello", "world"], withProbe(repo));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, "probe says hello to nobody\n".replace("nobody", "world"));
      assert.ok(repo.log().includes("cli:activate"));
    } finally {
      repo.cleanup();
    }
  });

  it("does not load the core entry for a command that declared it need not", () => {
    // `probe hello` says `needsCore: false`, because it reads no tree.
    const repo = probeRepo();
    try {
      repo.nav(["probe", "hello"], withProbe(repo));
      assert.equal(repo.log().includes("core"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("reads the tree through the plugin's own registered directory", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      repo.write(".navbook/probe/4711.json", "{}\n");
      const result = repo.nav(["probe", "tags"], withProbe(repo));
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^tags: flaky$/m);
      assert.match(result.stdout, /^reports: 1$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("subcommands complete from the manifest", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["__complete", "probe"], withProbe(repo));
      assert.deepEqual(result.stdout.split("\n").filter(Boolean).sort(), ["hello", "tags"]);
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("appear among the root completions", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["__complete"], withProbe(repo));
      assert.ok(result.stdout.split("\n").includes("probe"));
    } finally {
      repo.cleanup();
    }
  });
});

describe("the loading rule of spec 04 §4.3", () => {
  it("imports nothing for a listing no plugin contributes to", () => {
    // The assertion the startup budget depends on. `pr list` is the one to
    // make it on: the probe contributes to `issue list`, and a column cannot
    // be rendered without the plugin that declared it — which is the cost a
    // contribution openly buys, not a leak.
    const repo = probeRepo();
    try {
      clearLog(repo);
      const result = repo.nav(["pr", "list"], withProbe(repo));
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("imports the plugin for a listing it does contribute to", () => {
    // Stated as its own case so the line between the two is on the record.
    const repo = probeRepo();
    try {
      clearLog(repo);
      repo.nav(["issue", "list"], withProbe(repo));
      assert.ok(repo.log().includes("core"));
    } finally {
      repo.cleanup();
    }
  });

  it("imports nothing for an unrelated verb", () => {
    const repo = probeRepo();
    try {
      clearLog(repo);
      repo.nav(["id"], withProbe(repo));
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("loads core when a query names a registered term", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      clearLog(repo);
      const result = repo.nav(["issue", "list", "ptag:flaky"], withProbe(repo));
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /One/);
      assert.ok(repo.log().includes("core:activate"));
    } finally {
      repo.cleanup();
    }
  });

  it("matches nothing for a tag no entity carries", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      const result = repo.nav(["issue", "list", "ptag:green"], withProbe(repo));
      assert.equal(result.code, 0);
      assert.doesNotMatch(result.stdout, /One/);
    } finally {
      repo.cleanup();
    }
  });

  it("treats a registered term as free text when the plugin is absent", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      // No plugin path: `ptag:` is a word to search for, not a term.
      const result = repo.nav(["issue", "list", "ptag:flaky"]);
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /One/);
    } finally {
      repo.cleanup();
    }
  });

  it("loads core for doctor, which runs every registered check", () => {
    const repo = probeRepo();
    try {
      clearLog(repo);
      repo.nav(["doctor"], withProbe(repo));
      assert.ok(repo.log().includes("core:activate"));
    } finally {
      repo.cleanup();
    }
  });
});

describe("contributions to a built-in verb", () => {
  it("adds a declared option, which writes the plugin's frontmatter", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(
        ["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky", "--probe-tag", "slow"],
        withProbe(repo),
      );
      assert.equal(result.code, 0, result.stderr);
      const path = result.stdout.match(/Created (\S+)/)?.[1];
      assert.ok(path);
      const text = readFileSync(join(repo.dir, path, "issue.md"), "utf8");
      assert.match(text, /^probe-tag: \[flaky, slow\]$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("adds a declared option to a shared verb, and names a verb that does not exist", () => {
    // `list`, `show`, `close` and the rest are added by the shared-verb
    // builder; a contribution to one of them must find it there.
    const repo = probeRepo();
    try {
      const env = variantProbe(repo, (manifest) => {
        manifest.navbook.cli.contributions.push(
          { on: "issue list", options: [{ flags: "--probe-only", description: "probe rows" }] },
          { on: "pr close", options: [{ flags: "--probe-why <w>", description: "probe why" }] },
          { on: "issue lsit", options: [{ flags: "--probe-typo", description: "never seen" }] },
        );
      });
      const list = repo.nav(["issue", "list", "--help"], env);
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /--probe-only\s+probe rows/);
      const close = repo.nav(["pr", "close", "--help"], env);
      assert.match(close.stdout, /--probe-why <w>\s+probe why/);
      assert.match(
        list.stderr,
        /plugin @navbook\/plugin-probe contributes to 'issue lsit', which is not a nav command/,
      );
      assert.doesNotMatch(list.stderr, /'issue list'|'pr close'/);
    } finally {
      repo.cleanup();
    }
  });

  it("shows the declared option in the verb's help, with no plugin loaded", () => {
    // Help is free however many plugins contribute to the verb: it is built
    // from manifests, and `--help` runs no command that could need more.
    const repo = probeRepo();
    try {
      const result = repo.nav(["issue", "open", "--help"], withProbe(repo));
      assert.match(result.stdout, /--probe-tag <tag>\s+attach a probe tag/);
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("adds a column to the listing, only when some entity has one", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "Plain", "-m", "Body."], withProbe(repo));
      const plain = repo.nav(["issue", "list"], withProbe(repo));
      assert.doesNotMatch(plain.stdout, /TAGS/);

      repo.nav(["issue", "open", "Tagged", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      const tagged = repo.nav(["issue", "list", "ptag:flaky"], withProbe(repo));
      assert.match(tagged.stdout, /TAGS/);
      assert.match(tagged.stdout, /flaky/);
    } finally {
      repo.cleanup();
    }
  });

  it("merges keys into a listing's --json", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"], withProbe(repo));
      const result = repo.nav(["issue", "list", "ptag:flaky", "--json"], withProbe(repo));
      const row = JSON.parse(result.stdout.trim().split("\n")[0] as string);
      assert.deepEqual(row.probeTags, ["flaky"]);
      // The format's own keys are still there and still the format's.
      assert.equal(row.title, "One");
    } finally {
      repo.cleanup();
    }
  });

  it("adds a column and JSON keys to 'pr list', across refs too", () => {
    // `pr list` builds columns of its own (target, reviews, refs), and those
    // must be added to what plugins contributed rather than replace it.
    const repo = probeRepo();
    try {
      const env = prListProbe(repo);
      openPrElsewhere(repo, env);
      repo.git(["checkout", "--quiet", "feat/x"]);
      const here = repo.nav(["pr", "list"], env);
      assert.equal(here.code, 0, here.stderr);
      assert.match(here.stdout, /PROBE/);
      assert.match(here.stdout, /TARGET/);
      repo.git(["checkout", "--quiet", "main"]);

      const across = repo.nav(["pr", "list", "--all-refs"], env);
      assert.match(across.stdout, /PROBE/);
      assert.match(across.stdout, /REFS/);
      const json = repo.nav(["pr", "list", "--all-refs", "--json"], env);
      const row = JSON.parse(json.stdout.trim()) as { probeSeen?: boolean; refs: string[] };
      assert.equal(row.probeSeen, true);
      assert.deepEqual(row.refs, ["feat/x"]);
    } finally {
      repo.cleanup();
    }
  });

  it("never lets a plugin's JSON key replace one of the entity's own", () => {
    const repo = probeRepo();
    try {
      const env = prListProbe(repo, { title: "plugin", status: "hijacked", id: "nope" });
      openPrElsewhere(repo, env);
      repo.git(["checkout", "--quiet", "feat/x"]);
      for (const args of [["--json"], ["--all-refs", "--json"]]) {
        const result = repo.nav(["pr", "list", ...args], env);
        const row = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
        assert.equal(row.title, "X");
        assert.equal(row.status, "open");
        assert.match(String(row.id), /^[0-9a-z]{8}$/);
        // Its own keys still arrive.
        assert.equal(row.probeSeen, true);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("appends a section to show", () => {
    const repo = probeRepo();
    try {
      const opened = repo.nav(
        ["issue", "open", "One", "-m", "Body.", "--probe-tag", "flaky"],
        withProbe(repo),
      );
      const id = opened.stdout.match(/#(\w{8})/)?.[1];
      assert.ok(id);
      const result = repo.nav(["issue", "show", id], withProbe(repo));
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Probe tags: flaky/);
    } finally {
      repo.cleanup();
    }
  });

  it("offers the plugin's listing term, and its values", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "b", "--probe-tag", "flaky"], withProbe(repo));
      const words = repo.nav(["__complete", "issue", "list"], withProbe(repo)).stdout.split("\n");
      // The term itself is in the manifest; the values are the plugin's, and
      // it declared `completions` on this verb to be asked for them.
      assert.ok(words.includes("ptag:"));
      assert.ok(words.includes("ptag:flaky"));
    } finally {
      repo.cleanup();
    }
  });

  it("documents the plugin's listing term in 'list --help', loading nothing", () => {
    const repo = probeRepo();
    try {
      clearLog(repo);
      for (const kind of ["issue", "pr"]) {
        const result = repo.nav([kind, "list", "--help"], withProbe(repo));
        assert.equal(result.code, 0, result.stderr);
        // Re-aligned to the column the built-in terms use, whatever spacing
        // the manifest wrote it with.
        assert.match(result.stdout, /^ {2}ptag:T {22}T is among the entity's probe tags$/m);
        // Every term's hint, built-in or not, starts in the same column.
        const columns = [...result.stdout.matchAll(/^( {2}[a-z]+:\S* +)\S/gm)].map(
          (match) => (match[1] as string).length,
        );
        assert.equal(new Set(columns).size, 1, result.stdout);
        // The closing sentence names only the built-in terms, and says so.
        assert.match(result.stdout, /^A plugin's terms combine as their descriptions say\.$/m);
      }
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });

  it("completes on 'list' exactly the terms 'list --help' documents", () => {
    const repo = probeRepo();
    try {
      for (const kind of ["issue", "pr"]) {
        const offered = repo
          .nav(["__complete", kind, "list"], withProbe(repo))
          .stdout.split("\n")
          .filter((line) => /^[a-z]+:$/.test(line));
        const help = repo.nav([kind, "list", "--help"], withProbe(repo)).stdout;
        const documented = [...help.matchAll(/^ {2}([a-z]+):/gm)].map((m) => `${m[1]}:`);
        assert.deepEqual(offered, documented);
        assert.ok(documented.includes("ptag:"));
      }
    } finally {
      repo.cleanup();
    }
  });

  it("costs nothing to list a plugin noun's verbs", () => {
    // Verb names come from the manifest, so completing `nav probe <TAB>`
    // imports nothing — the cheap case stays cheap.
    const repo = probeRepo();
    try {
      clearLog(repo);
      repo.nav(["__complete", "probe"], withProbe(repo));
      assert.deepEqual(repo.log(), []);
    } finally {
      repo.cleanup();
    }
  });
});

describe("a plugin's doctor check", () => {
  it("reports what the plugin's tree location found wrong", () => {
    const repo = probeRepo();
    try {
      repo.write(".navbook/probe/notes.txt", "hello\n");
      const result = repo.nav(["doctor"], withProbe(repo));
      assert.equal(result.code, 2, result.stdout);
      assert.match(result.stdout, /X-probe-1/);
      assert.match(result.stdout, /'notes\.txt' is not one/);
    } finally {
      repo.cleanup();
    }
  });

  it("is silent about a directory it is happy with", () => {
    const repo = probeRepo();
    try {
      repo.write(".navbook/probe/4711.json", "{}\n");
      const result = repo.nav(["doctor"], withProbe(repo));
      assert.equal(result.code, 0, result.stdout + result.stderr);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves the directory alone when the plugin is absent", () => {
    // §2.12: a tool that does not understand a namespace preserves it.
    const repo = probeRepo({ declare: false });
    try {
      repo.write(".navbook/probe/notes.txt", "hello\n");
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0, result.stdout);
      assert.ok(existsSync(join(repo.dir, ".navbook/probe/notes.txt")));
    } finally {
      repo.cleanup();
    }
  });
});

describe("what a repository declares", () => {
  it("says once that a declared plugin is not installed", () => {
    const repo = probeRepo();
    try {
      // Declared, but no plugin path: the machine does not have it.
      const result = repo.nav(["issue", "list"]);
      assert.equal(result.code, 0, result.stderr);
      const lines = result.stderr.split("\n").filter((line) => line.includes("plugin-probe"));
      assert.equal(lines.length, 1);
      assert.match(lines[0] as string, /is declared in .* but is not installed/);
      assert.match(lines[0] as string, /nav plugin install/);
    } finally {
      repo.cleanup();
    }
  });

  it("carries on and answers the command anyway", () => {
    const repo = probeRepo();
    try {
      repo.nav(["issue", "open", "One", "-m", "Body."]);
      const result = repo.nav(["issue", "list"]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /One/);
    } finally {
      repo.cleanup();
    }
  });

  it("says nothing when the plugin is installed", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["issue", "list"], withProbe(repo));
      assert.doesNotMatch(result.stderr, /not installed/);
    } finally {
      repo.cleanup();
    }
  });

  it("names the plugin an undeclared namespace belongs to", () => {
    const repo = probeRepo({ declare: false });
    try {
      repo.write(".navbook/specs/auth/feature.md", "---\ntitle: Auth\n---\n\nSigning in.\n");
      const result = repo.nav(["issue", "list"]);
      assert.match(result.stderr, /belongs to @navbook\/plugin-kb/);
      assert.match(result.stderr, /does not declare/);
    } finally {
      repo.cleanup();
    }
  });

  it("says a namespace it knows no plugin for is preserved untouched", () => {
    const repo = probeRepo({ declare: false });
    try {
      repo.write(".navbook/whatever/x.json", "{}\n");
      const result = repo.nav(["issue", "list"]);
      assert.match(result.stderr, /whatever\/ is not a shape this nav reads/);
      assert.match(result.stderr, /preserved untouched/);
      assert.ok(existsSync(join(repo.dir, ".navbook/whatever/x.json")));
    } finally {
      repo.cleanup();
    }
  });

  it("is quiet about a namespace whose plugin is loaded", () => {
    const repo = probeRepo();
    try {
      repo.write(".navbook/probe/4711.json", "{}\n");
      const result = repo.nav(["issue", "list"], withProbe(repo));
      assert.doesNotMatch(result.stderr, /probe\/ is not a shape/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("a plugin that cannot be used", () => {
  it("is skipped, named, and does not stop the command", () => {
    const repo = probeRepo({ declare: false });
    try {
      // A directory that is not a plugin at all.
      const result = repo.nav(["issue", "list"], {
        NAVBOOK_PLUGIN_PATH: join(PACKAGE_ROOT, "test", "helpers"),
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /skipped/);
    } finally {
      repo.cleanup();
    }
  });

  it("is skipped when its plugin API range does not match", () => {
    const repo = probeRepo({ declare: false });
    try {
      const other = join(repo.home, "old-plugin");
      repo.write("../old-plugin/package.json", "");
      const result = repo.nav(["issue", "list"], { NAVBOOK_PLUGIN_PATH: other });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /skipped/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav plugin", () => {
  it("lists nothing, and says where the store is", () => {
    const repo = probeRepo({ declare: false });
    try {
      const result = repo.nav(["plugin", "list"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No plugins installed/);
      assert.match(result.stdout, /navbook[/\\]plugins/);
    } finally {
      repo.cleanup();
    }
  });

  it("lists a plugin on the path, and whether this repository declares it", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["plugin", "list"], withProbe(repo));
      assert.match(result.stdout, /@navbook\/plugin-probe\s+1\.0\.0\s+declared/);
    } finally {
      repo.cleanup();
    }
  });

  it("says a declared plugin is not installed", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["plugin", "list"]);
      assert.match(result.stdout, /@navbook\/plugin-probe.*declared, not installed/);
    } finally {
      repo.cleanup();
    }
  });

  it("emits one JSON object per plugin", () => {
    const repo = probeRepo();
    try {
      const result = repo.nav(["plugin", "list", "--json"], withProbe(repo));
      const row = JSON.parse(result.stdout.trim().split("\n")[0] as string);
      assert.equal(row.name, "@navbook/plugin-probe");
      assert.equal(row.declared, true);
      assert.equal(row.source, "path");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a name that could not be a plugin's, before touching the network", () => {
    // A bare word is a short name and is expanded, so the name that must be
    // refused outright is a scoped one: nothing can make `@acme/thing` a
    // plugin, and saying so costs no registry round trip.
    const repo = probeRepo({ declare: false });
    try {
      const result = repo.nav(["plugin", "install", "@acme/thing", "-y"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not named as a plugin/);
      assert.match(result.stderr, /@navbook\/plugin-<name>/);
    } finally {
      repo.cleanup();
    }
  });

  it("has nothing to do when the declaration is satisfied", () => {
    const repo = probeRepo({ declare: false });
    try {
      const result = repo.nav(["plugin", "install"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Nothing to do/);
    } finally {
      repo.cleanup();
    }
  });

  it("installs a plugin whose peers are the host's, and leaves them to the host", () => {
    // A plugin names @navbook/core as a peer for its types, and a web half
    // names its framework the same way, optionally. None of them belongs in
    // the store — the running `nav` is the core — so npm must not so much as
    // resolve them: a knowledge base whose optional Vue peers npm could not
    // reconcile was refused outright. Offline, so resolving any peer at all
    // would fail here rather than depend on what the registry holds today.
    const repo = probeRepo({ declare: false });
    try {
      const pkg = join(repo.home, "peerful");
      cpSync(PROBE, pkg, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
      manifest.peerDependencies = {
        "@navbook/core": "^0.4.0",
        vue: "^3.5.0",
        "@vue/apollo-composable": "^4.2.2",
      };
      manifest.peerDependenciesMeta = {
        vue: { optional: true },
        "@vue/apollo-composable": { optional: true },
      };
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest, null, 2));
      // A tarball, as a release smoke-tests and a registry serves: npm only
      // links a directory, and never looks at a linked package's peers.
      const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", repo.home], {
        cwd: pkg,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: repo.home, npm_config_offline: "true" },
      });
      assert.equal(packed.status, 0, packed.stderr);
      const tarball = join(repo.home, packed.stdout.trim());

      const installed = repo.nav(["plugin", "install", tarball, "-y"], {
        npm_config_offline: "true",
      });
      assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
      assert.match(installed.stdout, /Installed @navbook\/plugin-probe@1\.0\.0/);

      const modules = join(repo.home, ".local", "share", "navbook", "plugins", "node_modules");
      assert.ok(existsSync(join(modules, "@navbook", "plugin-probe")));
      for (const peer of ["@navbook/core", "vue", "@vue/apollo-composable"]) {
        assert.ok(!existsSync(join(modules, peer)), `${peer} was installed into the store`);
      }
      assert.match(repo.nav(["plugin", "list"]).stdout, /@navbook\/plugin-probe\s+1\.0\.0/);
    } finally {
      repo.cleanup();
    }
  });

  it("records the version npm installed over an older one", () => {
    // The spec typed is not a directory in node_modules: the index must follow
    // what npm wrote into the store, or 2.0.0 runs while `list` says 1.0.0.
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    try {
      npm.publish("1.0.0");
      npm.publish("2.0.0");
      const first = repo.nav(["plugin", "install", "@navbook/plugin-probe@1.0.0", "-y"], npm.env);
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stdout, /Installed @navbook\/plugin-probe@1\.0\.0/);

      const second = repo.nav(["plugin", "install", "@navbook/plugin-probe@2.0.0", "-y"], npm.env);
      assert.equal(second.code, 0, second.stderr);
      assert.match(second.stdout, /Installed @navbook\/plugin-probe@2\.0\.0/);
      assert.deepEqual(listed(repo, npm.env), ["@navbook/plugin-probe@2.0.0"]);
      // Nothing was mistaken for a package that is not a plugin and removed.
      assert.ok(!npm.log().some((line) => line.startsWith("uninstall")), npm.log().join("\n"));
    } finally {
      repo.cleanup();
    }
  });

  it("records a folder installed over the plugin it replaces", () => {
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    try {
      const v1 = npm.copy("1.0.0", join(repo.home, "probe-v1"));
      const v2 = npm.copy("2.0.0", join(repo.home, "probe-v2"));
      assert.equal(repo.nav(["plugin", "install", v1, "-y"], npm.env).code, 0);
      const result = repo.nav(["plugin", "install", v2, "-y"], npm.env);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Installed @navbook\/plugin-probe@2\.0\.0/);
      assert.deepEqual(listed(repo, npm.env), ["@navbook/plugin-probe@2.0.0"]);

      // The same folder, rebuilt in place: npm saves the same path, and the
      // index still has to follow the version now in it.
      npm.copy("3.0.0", v2);
      const rebuilt = repo.nav(["plugin", "install", v2, "-y"], npm.env);
      assert.equal(rebuilt.code, 0, rebuilt.stderr);
      assert.deepEqual(listed(repo, npm.env), ["@navbook/plugin-probe@3.0.0"]);
    } finally {
      repo.cleanup();
    }
  });

  it("falls back from @navbook/plugin-<name> to navbook-plugin-<name> for a short name", () => {
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    try {
      npm.publish("1.0.0", "navbook-plugin-probe");
      // Both candidates are named before anything runs.
      const asked = repo.nav(["plugin", "install", "probe"], npm.env, "n\n");
      assert.match(
        asked.stdout,
        /npm install .*@navbook\/plugin-probe, or npm install .*navbook-plugin-probe/,
      );
      assert.deepEqual(npm.log(), []);

      const result = repo.nav(["plugin", "install", "probe", "-y"], npm.env);
      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /Installed navbook-plugin-probe@1\.0\.0/);
      assert.deepEqual(listed(repo, npm.env), ["navbook-plugin-probe@1.0.0"]);
    } finally {
      repo.cleanup();
    }
  });

  it("prefers @navbook/plugin-<name> when the registry has it", () => {
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    try {
      npm.publish("1.0.0");
      npm.publish("1.0.0", "navbook-plugin-probe");
      const result = repo.nav(["plugin", "install", "probe", "-y"], npm.env);
      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(listed(repo, npm.env), ["@navbook/plugin-probe@1.0.0"]);
      assert.equal(npm.log().length, 1);
    } finally {
      repo.cleanup();
    }
  });

  it("works outside a repository, since the store is the user's", () => {
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    // The home directory is beside the repository, not in it; the ceiling
    // keeps git from finding any repository the test directory sits in.
    const outside = (args: string[]): RunResult => {
      const command = navCommand();
      const result = spawnSync(command[0] as string, [...command.slice(1), ...args], {
        cwd: repo.home,
        encoding: "utf8",
        env: {
          ...deterministicEnv(repo.home),
          ...npm.env,
          GIT_CEILING_DIRECTORIES: dirname(repo.home),
        },
      });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    };
    try {
      npm.publish("1.0.0");
      const installed = outside(["plugin", "install", "@navbook/plugin-probe", "-y"]);
      assert.equal(installed.code, 0, installed.stderr);
      assert.match(installed.stdout, /Installed @navbook\/plugin-probe@1\.0\.0/);
      const list = outside(["plugin", "list"]);
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /@navbook\/plugin-probe\s+1\.0\.0/);

      npm.publish("1.1.0");
      const updated = outside(["plugin", "update", "@navbook/plugin-probe", "-y"]);
      assert.equal(updated.code, 0, updated.stderr);
      assert.match(updated.stdout, /Updated @navbook\/plugin-probe 1\.0\.0 → 1\.1\.0/);
      const removed = outside(["plugin", "remove", "@navbook/plugin-probe", "-y"]);
      assert.equal(removed.code, 0, removed.stderr);
      assert.match(removed.stdout, /Removed @navbook\/plugin-probe/);
    } finally {
      repo.cleanup();
    }
  });

  it("updates and removes a plugin by its short name", () => {
    const repo = probeRepo({ declare: false });
    const npm = fakeNpm(repo);
    try {
      npm.publish("1.0.0");
      assert.equal(repo.nav(["plugin", "install", "probe", "-y"], npm.env).code, 0);
      npm.publish("1.1.0");
      const updated = repo.nav(["plugin", "update", "probe", "-y"], npm.env);
      assert.equal(updated.code, 0, updated.stderr);
      assert.match(updated.stdout, /Updated @navbook\/plugin-probe 1\.0\.0 → 1\.1\.0/);
      const removed = repo.nav(["plugin", "remove", "probe", "-y"], npm.env);
      assert.equal(removed.code, 0, removed.stderr);
      assert.match(removed.stdout, /Removed @navbook\/plugin-probe/);
      assert.deepEqual(listed(repo, npm.env), []);
    } finally {
      repo.cleanup();
    }
  });

  it("prints the npm command it would run, and asks", () => {
    const repo = probeRepo();
    try {
      // Answering no leaves the machine alone, which is the whole contract.
      const result = repo.nav(["plugin", "install"], undefined, "n\n");
      assert.match(result.stdout, /npm install --ignore-scripts/);
      assert.match(result.stdout, /@navbook\/plugin-probe/);
      assert.match(result.stdout, /Aborted/);
    } finally {
      repo.cleanup();
    }
  });
});
