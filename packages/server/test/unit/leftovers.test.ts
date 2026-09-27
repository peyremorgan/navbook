/**
 * What an interrupted git leaves behind, found and cleared — and nothing else.
 *
 * The files are planted by hand, where a SIGKILLed maintenance run leaves them
 * (#cvb57nhm has the runs that showed it). As much of the point is what is
 * never touched: a lock on the index or a ref is a cut-short commit, a
 * person's to look at, and a pack without `tmp_` in its name is the clone.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  clearLeftovers,
  clearLeftoversAtStart,
  findCutShort,
  findLeftovers,
  type GitDirs,
  gitDirs,
  gitsRunningIn,
  removeLeftovers,
} from "../../src/leftovers.ts";

/** What a killed maintenance run, fetch or repack can leave, relative to the repository. */
const LEFTOVERS = [
  ".git/packed-refs.lock",
  ".git/gc.pid",
  ".git/gc.log.lock",
  ".git/objects/maintenance.lock",
  ".git/objects/info/commit-graph.lock",
  ".git/objects/info/commit-graphs/commit-graph-chain.lock",
  ".git/objects/info/commit-graphs/tmp_graph_Ab12Cd",
  ".git/objects/pack/multi-pack-index.lock",
  ".git/objects/pack/multi-pack-index.d/multi-pack-index-chain.lock",
  ".git/objects/pack/multi-pack-index.d/tmp_midx_Xy12Zw",
  ".git/objects/pack/tmp_pack_BhOOJi",
  ".git/objects/pack/tmp_idx_Q9w8e7",
  ".git/objects/pack/.tmp-176-pack-0123abcd.pack",
  ".git/objects/bitmap-ref-tips_nda6C1",
];

/** What must never be taken for one: cut-short work, and the clone itself. */
const KEPT = [
  ".git/index.lock",
  ".git/HEAD.lock",
  ".git/refs/heads/main.lock",
  ".git/refs/remotes/origin/fix/b.lock",
  ".git/config.lock",
  ".git/objects/pack/pack-0123abcd.pack",
  ".git/objects/pack/multi-pack-index",
  ".git/objects/info/commit-graphs/commit-graph-chain",
  ".git/objects/info/packs",
  ".git/packed-refs",
  ".git/objects/ab/tmp_obj_Kk1234",
  // Named like one, but a quarantine for objects on their way in, not housekeeping's.
  ".git/objects/tmp_objdir-incoming-x",
];

let root: string;
let dirs: GitDirs;

function plant(paths: readonly string[], mtimeSeconds?: number): void {
  for (const path of paths) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "x".repeat(10));
    if (mtimeSeconds !== undefined) utimesSync(full, mtimeSeconds, mtimeSeconds);
  }
}

function relativeFound(age: Parameters<typeof findLeftovers>[1] = {}): string[] {
  return findLeftovers(dirs, age)
    .map((leftover) => leftover.path.slice(root.length + 1))
    .sort();
}

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "navbook-leftovers-")));
  spawnSync("git", ["init", "--quiet", "-b", "main", root]);
  dirs = gitDirs(root);
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("gitDirs", () => {
  it("names the common directory and the object directory, absolute", () => {
    assert.deepEqual(dirs, { common: join(root, ".git"), objects: join(root, ".git/objects") });
  });

  it("follows an object directory that lives elsewhere", () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "navbook-objects-")));
    const saved = process.env.GIT_OBJECT_DIRECTORY;
    process.env.GIT_OBJECT_DIRECTORY = elsewhere;
    try {
      assert.deepEqual(gitDirs(root), { common: join(root, ".git"), objects: elsewhere });
    } finally {
      if (saved === undefined) delete process.env.GIT_OBJECT_DIRECTORY;
      else process.env.GIT_OBJECT_DIRECTORY = saved;
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("refuses a directory that is no repository", () => {
    const bare = mkdtempSync(join(tmpdir(), "navbook-no-repo-"));
    try {
      assert.throws(() => gitDirs(bare), /cannot find the git directories/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("findLeftovers", () => {
  it("finds every housekeeping leftover, and nothing a person should see", () => {
    plant(LEFTOVERS);
    plant(KEPT);
    // A directory named like a temporary file is not one to unlink.
    mkdirSync(join(root, ".git/objects/pack/tmp_pack_dir"), { recursive: true });
    assert.deepEqual(relativeFound(), [...LEFTOVERS].sort());
    rmSync(join(root, ".git/objects/pack/tmp_pack_dir"), { recursive: true });
  });

  it("tells a lock from a temporary file, and gives the file's size", () => {
    const byPath = new Map(findLeftovers(dirs).map((leftover) => [leftover.path, leftover]));
    assert.equal(byPath.get(join(root, ".git/packed-refs.lock"))?.kind, "lock");
    const pack = byPath.get(join(root, ".git/objects/pack/tmp_pack_BhOOJi"));
    assert.equal(pack?.kind, "temporary file");
    assert.equal(pack?.bytes, 10);
  });

  it("keeps to the age it is given, either side of a moment", () => {
    const old = [".git/packed-refs.lock", ".git/objects/pack/tmp_pack_BhOOJi"];
    plant(old, 1_000_000); // 1970: long before anything started
    const moment = 2_000_000_000; // 2033, in seconds
    const fresh = [".git/objects/maintenance.lock", ".git/objects/pack/tmp_idx_Q9w8e7"];
    plant(fresh, moment + 10);

    const before = relativeFound({ modifiedBefore: moment * 1000 });
    for (const path of old) assert.ok(before.includes(path), `${path} is older than the moment`);
    for (const path of fresh) assert.ok(!before.includes(path), `${path} is newer`);

    const since = relativeFound({ modifiedSince: (moment + 10) * 1000 });
    assert.deepEqual(since, [...fresh].sort());
  });

  it("finds nothing in a clone nothing was left in", () => {
    const clean = mkdtempSync(join(tmpdir(), "navbook-clean-"));
    try {
      spawnSync("git", ["init", "--quiet", clean]);
      assert.deepEqual(findLeftovers(gitDirs(clean)), []);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });
});

describe("removeLeftovers", () => {
  it("removes each one and says so, leaving the rest of the clone alone", () => {
    plant(LEFTOVERS);
    const lines: string[] = [];
    const found = findLeftovers(dirs);
    removeLeftovers(found, root, (line) => lines.push(line));
    assert.deepEqual(relativeFound(), []);
    for (const path of KEPT) assert.ok(existsSync(join(root, path)), `${path} was removed`);
    assert.equal(lines.length, found.length);
    assert.ok(
      lines.includes(
        "nav-server: removed .git/packed-refs.lock (a lock an interrupted git left behind)",
      ),
      lines.join("\n"),
    );
    assert.ok(
      lines.includes(
        "nav-server: removed .git/objects/pack/tmp_pack_BhOOJi " +
          "(a temporary file an interrupted git left behind, 10 bytes)",
      ),
      lines.join("\n"),
    );
  });

  it("says which one it could not remove, and still removes the others", {
    skip: process.getuid?.() === 0 && "root may remove anything",
  }, () => {
    plant([".git/packed-refs.lock", ".git/objects/info/commit-graphs/commit-graph-chain.lock"]);
    const locked = join(root, ".git/objects/info/commit-graphs");
    chmodSync(locked, 0o555);
    const lines: string[] = [];
    try {
      removeLeftovers(findLeftovers(dirs), root, (line) => lines.push(line));
    } finally {
      chmodSync(locked, 0o755);
    }
    assert.equal(existsSync(join(root, ".git/packed-refs.lock")), false);
    assert.ok(existsSync(join(locked, "commit-graph-chain.lock")));
    assert.ok(
      lines.some((line) =>
        line.startsWith(
          "nav-server: could not remove .git/objects/info/commit-graphs/commit-graph-chain.lock",
        ),
      ),
      lines.join("\n"),
    );
    rmSync(join(locked, "commit-graph-chain.lock"));
  });

  it("does not mind one that has gone already", () => {
    plant([".git/gc.pid"]);
    const found = findLeftovers(dirs);
    rmSync(join(root, ".git/gc.pid"));
    const lines: string[] = [];
    removeLeftovers(found, root, (line) => lines.push(line));
    assert.equal(lines.length, 1);
    assert.match(lines[0] as string, /^nav-server: removed \.git\/gc\.pid/);
  });
});

/** A repository of its own, with files planted relative to it. */
function freshRepo(): {
  root: string;
  dirs: GitDirs;
  plant: (paths: readonly string[], mtimeSeconds?: number) => void;
} {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "navbook-leftovers-")));
  after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync("git", ["init", "--quiet", "-b", "main", dir]);
  return {
    root: dir,
    dirs: gitDirs(dir),
    plant: (paths, mtimeSeconds) => {
      for (const path of paths) {
        const full = join(dir, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, "x");
        if (mtimeSeconds !== undefined) utimesSync(full, mtimeSeconds, mtimeSeconds);
      }
    },
  };
}

const CUT_SHORT = [
  ".git/index.lock",
  ".git/HEAD.lock",
  ".git/refs/heads/main.lock",
  ".git/refs/remotes/origin/fix/b.lock",
  ".git/logs/refs/heads/main.lock",
];

describe("findCutShort", () => {
  it("finds the locks of a commit or ref update cut short, however deep", () => {
    const repo = freshRepo();
    repo.plant(CUT_SHORT);
    repo.plant([".git/refs/heads/main", ".git/logs/HEAD", ".git/packed-refs.lock"]);
    const found = findCutShort(repo.dirs).map((leftover) =>
      leftover.path.slice(repo.root.length + 1),
    );
    assert.deepEqual(found.sort(), [...CUT_SHORT].sort());
  });
});

describe("clearLeftovers", () => {
  it("removes nothing while a git runs in the clone, and says which", () => {
    const repo = freshRepo();
    repo.plant([".git/packed-refs.lock", ".git/objects/pack/tmp_pack_x"]);
    const lines: string[] = [];
    clearLeftovers(repo.dirs, repo.root, {
      remove: true,
      running: [4242, 4243],
      report: (line) => lines.push(line),
    });
    assert.ok(existsSync(join(repo.root, ".git/packed-refs.lock")));
    assert.ok(existsSync(join(repo.root, ".git/objects/pack/tmp_pack_x")));
    assert.deepEqual(lines, [
      "warning: .git/packed-refs.lock (a lock an interrupted git left behind) is left in place, " +
        "since a git is running in the clone (pid 4242, 4243); remove it if nothing is running",
    ]);
  });

  it("keeps to what changed since a moment, for a run that ran out of time", () => {
    const repo = freshRepo();
    const start = Date.now();
    repo.plant([".git/objects/pack/tmp_pack_old"], start / 1000 - 60);
    repo.plant(
      [".git/objects/pack/tmp_pack_new", ".git/objects/maintenance.lock"],
      start / 1000 + 1,
    );
    const lines: string[] = [];
    clearLeftovers(repo.dirs, repo.root, {
      since: start,
      remove: true,
      running: [],
      report: (line) => lines.push(line),
    });
    assert.ok(existsSync(join(repo.root, ".git/objects/pack/tmp_pack_old")));
    assert.equal(existsSync(join(repo.root, ".git/objects/pack/tmp_pack_new")), false);
    assert.equal(existsSync(join(repo.root, ".git/objects/maintenance.lock")), false);
    assert.equal(lines.length, 2);
  });

  it("says nothing, and looks for no git, when there is nothing to clear", () => {
    const repo = freshRepo();
    const lines: string[] = [];
    clearLeftovers(repo.dirs, repo.root, { remove: true, report: (line) => lines.push(line) });
    assert.deepEqual(lines, []);
  });
});

describe("clearLeftoversAtStart", () => {
  it("clears what was there before the start, and not what came after", () => {
    const repo = freshRepo();
    const start = Date.now();
    repo.plant([".git/packed-refs.lock", ".git/objects/pack/tmp_pack_BhOOJi"], start / 1000 - 60);
    repo.plant([".git/objects/maintenance.lock"], start / 1000 + 60);
    const lines: string[] = [];
    clearLeftoversAtStart(repo.dirs, repo.root, {
      before: start,
      remove: true,
      running: [],
      report: (line) => lines.push(line),
    });
    const left = findLeftovers(repo.dirs).map((leftover) =>
      leftover.path.slice(repo.root.length + 1),
    );
    assert.deepEqual(left, [".git/objects/maintenance.lock"]);
    assert.equal(lines.length, 2);
  });

  it("only warns about the locks when housekeeping is somebody else's", () => {
    const repo = freshRepo();
    const start = Date.now();
    repo.plant([".git/packed-refs.lock", ".git/objects/pack/tmp_pack_BhOOJi"], start / 1000 - 60);
    const lines: string[] = [];
    clearLeftoversAtStart(repo.dirs, repo.root, {
      before: start,
      remove: false,
      report: (line) => lines.push(line),
    });
    assert.equal(findLeftovers(repo.dirs).length, 2, "nothing was removed");
    assert.deepEqual(lines, [
      "warning: .git/packed-refs.lock (a lock an interrupted git left behind) is left in place, " +
        "since --maintenance-interval-ms 0 leaves housekeeping to something else; " +
        "remove it if nothing is running",
    ]);
  });

  it("names a commit or ref update cut short, and leaves it for a person", () => {
    const repo = freshRepo();
    const start = Date.now();
    repo.plant([".git/refs/heads/main.lock", ".git/index.lock"], start / 1000 - 60);
    repo.plant([".git/HEAD.lock"], start / 1000 + 60);
    const lines: string[] = [];
    for (const remove of [true, false]) {
      clearLeftoversAtStart(repo.dirs, repo.root, {
        before: start,
        remove,
        running: [],
        report: (line) => lines.push(line),
      });
    }
    for (const path of [".git/refs/heads/main.lock", ".git/index.lock", ".git/HEAD.lock"]) {
      assert.ok(existsSync(join(repo.root, path)), `${path} was removed`);
    }
    const once = [
      "warning: .git/index.lock (a lock a cut-short commit or ref update left behind) is left in " +
        "place for a person to look at; git refuses to update what it locks until it is removed",
      "warning: .git/refs/heads/main.lock (a lock a cut-short commit or ref update left behind) " +
        "is left in place for a person to look at; git refuses to update what it locks until it " +
        "is removed",
    ];
    // Whether or not the server owns housekeeping, and nothing newer than the start.
    assert.deepEqual(lines, [...once, ...once]);
  });
});

describe("gitsRunningIn", { skip: process.platform !== "linux" && "reads /proc" }, () => {
  /** A git that naps, as a long `gc` would, started however the test says. */
  async function napping(
    use: (pid: number) => void,
    args: string[],
    opts: { cwd: string; env?: NodeJS.ProcessEnv },
  ): Promise<void> {
    const child = spawn("git", [...args, "-c", "alias.nap=!sleep 30", "nap"], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      use(child.pid as number);
    } finally {
      child.kill("SIGKILL");
    }
  }

  it("finds a git whose working directory is in the clone, and only there", async () => {
    const repo = freshRepo();
    const other = freshRepo();
    await napping(
      (pid) => {
        assert.ok(gitsRunningIn(repo.dirs, repo.root).includes(pid));
        assert.ok(!gitsRunningIn(other.dirs, other.root).includes(pid));
      },
      [],
      { cwd: repo.root },
    );
  });

  it("finds a git pointed at the clone from elsewhere, by flag or by environment", async () => {
    const repo = freshRepo();
    const elsewhere = realpathSync(tmpdir());
    const git = join(repo.root, ".git");
    await napping(
      (pid) => assert.ok(gitsRunningIn(repo.dirs, repo.root).includes(pid)),
      [`--git-dir=${git}`],
      {
        cwd: elsewhere,
      },
    );
    await napping(
      (pid) => assert.ok(gitsRunningIn(repo.dirs, repo.root).includes(pid)),
      ["--git-dir", git],
      {
        cwd: elsewhere,
      },
    );
    await napping((pid) => assert.ok(gitsRunningIn(repo.dirs, repo.root).includes(pid)), [], {
      cwd: elsewhere,
      env: { GIT_DIR: git },
    });
  });

  it("finds it when the clone is named through a symlink", async () => {
    const repo = freshRepo();
    const link = `${repo.root}-link`;
    symlinkSync(repo.root, link);
    after(() => rmSync(link, { force: true }));
    // /proc gives the real path; the server may have been given the link.
    await napping((pid) => assert.ok(gitsRunningIn(gitDirs(link), link).includes(pid)), [], {
      cwd: repo.root,
    });
  });

  it("finds a git at work in another worktree of the same repository", async () => {
    const main = freshRepo();
    spawnSync("git", [
      "-C",
      main.root,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-qm",
      "x",
    ]);
    const linked = `${main.root}-linked`;
    after(() => rmSync(linked, { recursive: true, force: true }));
    spawnSync("git", ["-C", main.root, "worktree", "add", "-q", linked]);
    // Serving the linked worktree, while a git works in the main one: the
    // locks it may hold are in the repository both share.
    await napping((pid) => assert.ok(gitsRunningIn(gitDirs(linked), linked).includes(pid)), [], {
      cwd: main.root,
    });
    await napping((pid) => assert.ok(gitsRunningIn(main.dirs, main.root).includes(pid)), [], {
      cwd: linked,
    });
  });
});
