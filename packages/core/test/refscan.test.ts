import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { git } from "../src/git/exec.ts";
import { listRefShasAsync, lsTreeEntries } from "../src/git/refscan.ts";

const dir = mkdtempSync(join(tmpdir(), "navbook-refscan-"));
after(() => rmSync(dir, { recursive: true, force: true }));
git(["init", "--quiet", "-b", "main"], { cwd: dir });
git(["config", "user.name", "Nav Test"], { cwd: dir });
git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
git(["config", "commit.gpgsign", "false"], { cwd: dir });
const texts = ["one\n", "two, longer\n", "three, the longest of them\n"];
for (const [index, text] of texts.entries()) writeFileSync(join(dir, `f${index}.txt`), text);
git(["add", "-A"], { cwd: dir });
git(["commit", "--quiet", "-m", "files"], { cwd: dir });
const tree = git(["rev-parse", "HEAD^{tree}"], { cwd: dir }).trim();

describe("lsTreeEntries", () => {
  it("lists each blob with its SHA and size", () => {
    const entries = lsTreeEntries(dir, tree);
    assert.deepEqual(
      entries.map(({ type, size, path }) => [type, size, path]),
      texts.map((text, index) => ["blob", Buffer.byteLength(text), `f${index}.txt`]),
    );
  });

  it("throws on a tree git cannot list, rather than answering nothing", () => {
    assert.throws(() => lsTreeEntries(dir, "0".repeat(40)));
  });
});

describe("listRefShasAsync", () => {
  it("names every ref under the prefixes with its commit, leaving symbolic ones out", async () => {
    const head = git(["rev-parse", "HEAD"], { cwd: dir }).trim();
    git(["update-ref", "refs/remotes/origin/main", head], { cwd: dir });
    git(["update-ref", "refs/remotes/origin/feat/x", head], { cwd: dir });
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: dir });
    const refs = await listRefShasAsync(dir, ["refs/remotes/origin/", "refs/heads/main"]);
    assert.deepEqual([...refs].sort(), [
      ["refs/heads/main", head],
      ["refs/remotes/origin/feat/x", head],
      ["refs/remotes/origin/main", head],
    ]);
  });

  it("answers an empty map when nothing is under the prefixes", async () => {
    assert.deepEqual(await listRefShasAsync(dir, ["refs/remotes/nowhere/"]), new Map());
  });

  it("throws where git cannot list refs at all", async () => {
    await assert.rejects(listRefShasAsync(join(dir, "missing"), ["refs/heads/"]));
  });
});
