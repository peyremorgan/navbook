/**
 * `nav poll open|show|list|edit|close|reopen`, and what the plugin adds to
 * `nav issue show` and `nav issue list`, at the terminal.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import type { TempRepo } from "@navbook/cli/test-helpers";
import {
  as,
  DRAFT,
  lastMessage,
  makePollRepo,
  openIssue,
  openPoll,
  PLUGIN,
  read,
  shown,
} from "./helpers.ts";

const BOB = as("Bob", "bob@example.com", "2026-08-01T11:00:00Z");
const ANN = as("Ann", "ann@example.com", "2026-08-01T11:05:00Z");

describe("nav poll open", () => {
  let repo: TempRepo;
  let issue: string;
  before(() => {
    repo = makePollRepo();
    issue = openIssue(repo);
  });
  after(() => repo.cleanup());

  it("opens a poll from stdin, filling in the IDs left out, in one commit", () => {
    const result = repo.nav(
      ["poll", "open", issue.slice(0, 5), "--from", "-", "--commit"],
      undefined,
      DRAFT.replace("  - id: backend\n    text:", "  - text:").replace(
        "{ id: disk, label: Local disk }",
        "{ label: Local disk }",
      ),
    );
    assert.equal(result.code, 0, result.stderr);
    const id = (result.stdout.match(/^Opened poll ([a-z0-9]{8}) on #(\w+) {2}(\S+)$/m) ??
      []) as string[];
    assert.equal(id[2], issue);
    assert.match(
      lastMessage(repo),
      new RegExp(`^docs\\(poll\\): open ${id[1]} on #${issue}\n\nRefs: ${issue}$`),
    );
    const text = read(repo, `${id[3]}/poll.md`);
    assert.match(text, /^author: Nav Test <nav@test\.invalid>$/m);
    assert.match(text, /^ {2}- id: q1\n {4}text: Which storage backend\?$/m);
    assert.match(text, /^ {6}- id: local-disk\n {8}label: Local disk$/m);
    assert.match(text, /\n---\n\nWhere do we keep attachments\?\n$/);
    assert.match(id[3] ?? "", /\/poll\/[a-z0-9]{8}-attachment-storage$/);
  });

  it("reads a file, and takes --title over the one it has", () => {
    writeFileSync(join(repo.home, "draft.md"), DRAFT);
    const result = repo.nav([
      "poll",
      "open",
      issue,
      "--from",
      join(repo.home, "draft.md"),
      "--title",
      "Storage, take two",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\/poll\/[a-z0-9]{8}-storage-take-two\n$/);
    repo.git(["reset", "-q", "--hard"]);
    repo.git(["clean", "-qfd", ".navbook"]);
  });

  it("opens the editor on a template that is refused unless filled in", () => {
    const keep = repo.editor("keep.sh", `cp "$1" "${repo.home}/buffer.md"`);
    const unchanged = repo.nav(["poll", "open", issue, "--title", "Colours"], { EDITOR: keep });
    assert.equal(unchanged.code, 1);
    assert.match(unchanged.stderr, /the poll is not valid and was not created/);
    assert.match(unchanged.stderr, /missing required key 'questions'/);
    const buffer = readFileSync(join(repo.home, "buffer.md"), "utf8");
    assert.match(buffer, /^title: "Colours"$/m);
    assert.match(buffer, /^# {2}- text: Which storage backend\?$/m);

    const fill = repo.editor(
      "fill.sh",
      `printf '%s\\n' '---' 'title: Colours' 'questions:' '  - text: Which?' '    options: [{ label: Red }, { label: Blue }]' '---' '' '<!-- The preamble: what a voter needs to know first. Markdown; may be empty. -->' > "$1"`,
    );
    const filled = repo.nav(["poll", "open", issue], { EDITOR: fill });
    assert.equal(filled.code, 0, filled.stderr);
    const dir = filled.stdout.trim().split("  ").pop() as string;
    assert.doesNotMatch(read(repo, `${dir}/poll.md`), /preamble/, "the placeholder is not kept");
    repo.git(["reset", "-q", "--hard"]);
    repo.git(["clean", "-qfd", ".navbook"]);
  });

  it("refuses an invalid poll and a closed issue, and writes nothing", () => {
    const one = repo.nav(
      ["poll", "open", issue, "--from", "-"],
      undefined,
      DRAFT.replace("    other: true\n", "").replace(
        "      - { id: disk, label: Local disk }\n",
        "",
      ),
    );
    assert.equal(one.code, 1);
    assert.match(
      one.stderr,
      /the poll is not valid: questions\[1\]: a question must offer at least two choices/,
    );
    const missing = repo.nav(["poll", "open", issue, "--from", "nope.md"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /cannot read nope\.md/);
    const other = openIssue(repo, "Closed one");
    assert.equal(repo.nav(["issue", "close", other, "--commit"]).code, 0);
    const closed = repo.nav(["poll", "open", other, "--from", "-"], undefined, DRAFT);
    assert.equal(closed.code, 1);
    assert.match(closed.stderr, new RegExp(`#${other} is closed; reopen it to ask anything in it`));
    const noEditor = repo.nav(["poll", "open", other], {
      EDITOR: repo.editor("fail.sh", "exit 3"),
    });
    assert.equal(noEditor.code, 1);
    assert.match(
      noEditor.stderr,
      /is closed; reopen it to ask anything in it/,
      "refused before the editor",
    );
    assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
  });
});

describe("nav poll show and list", () => {
  let repo: TempRepo;
  let issue: string;
  let poll: string;
  before(() => {
    repo = makePollRepo();
    issue = openIssue(repo);
    poll = openPoll(repo, issue);
  });
  after(() => repo.cleanup());

  it("shows the questions, and hides the results until you vote", () => {
    assert.equal(repo.nav(["poll", "vote", poll, "--pick", "backend=s3", "--commit"], BOB).code, 0);
    const result = repo.nav(["poll", "show", poll]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^${poll}  Attachment storage  open\n`));
    assert.match(result.stdout, new RegExp(`issue: +#${issue}  Attachments`));
    assert.match(result.stdout, /voters: +1/);
    assert.match(result.stdout, /you: +you have not voted/);
    assert.match(result.stdout, /Results are hidden until you vote; --results shows them\./);
    assert.match(result.stdout, /1\. Which storage backend\? {2}\(one answer, or in other words\)/);
    assert.match(result.stdout, /2\. Which limits do we enforce\? {2}\(any number of answers\)/);
    assert.doesNotMatch(result.stdout, /Bob/);

    const revealed = repo.nav(["poll", "show", poll, "--results"]);
    assert.match(revealed.stdout, /s3 +S3-compatible +1 {2}Bob\n/);
    assert.match(revealed.stdout, /leading: s3/);

    const theirs = repo.nav(["poll", "show", poll], BOB);
    assert.match(theirs.stdout, /you: +you voted/);
    assert.match(theirs.stdout, / \* s3 /, "their own pick is marked");
    assert.doesNotMatch(theirs.stdout, /hidden/);
  });

  it("gives everything as JSON, results and where you stand included", () => {
    const json = shown(repo, poll, BOB);
    assert.equal(json.id, poll);
    assert.equal(json.issue, issue);
    assert.equal(json.status, "open");
    assert.equal(json.voters, 1);
    assert.deepEqual((json.me as Record<string, unknown>).state, "counted");
    assert.deepEqual((json.tallies as { leaders: string[] }[])[0]?.leaders, ["s3"]);
    assert.equal((json.ballots as unknown[]).length, 1);
    const mine = shown(repo, poll);
    assert.equal((mine.me as Record<string, unknown>).state, "none");
  });

  it("lists the open polls waiting on you, every poll with --all, and those of one issue", () => {
    const quiet = repo.nav(["poll", "list"]);
    assert.equal(quiet.code, 0, quiet.stderr);
    assert.match(
      quiet.stdout,
      new RegExp(`${poll} +#${issue} +open +1 +not voted +Attachment storage`),
      "the issue's author is asked",
    );
    assert.equal(repo.nav(["poll", "list"], BOB).stdout, "No polls are waiting on you.\n");
    const stranger = as("Zed", "zed@example.com");
    assert.equal(repo.nav(["poll", "list"], stranger).stdout, "No polls are waiting on you.\n");
    assert.match(repo.nav(["poll", "list", "--all"], stranger).stdout, new RegExp(poll));
    assert.equal(repo.nav(["poll", "list", "--state", "closed"]).stdout, "No polls match.\n");
    assert.match(repo.nav(["poll", "list", "--issue", issue.slice(0, 4)]).stdout, new RegExp(poll));
    const json = repo.nav(["poll", "list", "--all", "--json"], BOB);
    assert.deepEqual(JSON.parse(json.stdout), {
      id: poll,
      issue,
      path: JSON.parse(json.stdout).path,
      title: "Attachment storage",
      status: "open",
      "closed-by-issue": false,
      deadline: null,
      voters: 1,
      me: "counted",
    });
    const bad = repo.nav(["poll", "list", "--state", "maybe"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--state takes open or closed/);
  });

  it("adds the polls to nav issue show, and answers poll: and poll-awaiting: in nav issue list", () => {
    const detail = repo.nav(["issue", "show", issue]);
    assert.equal(detail.code, 0, detail.stderr);
    assert.match(
      detail.stdout,
      new RegExp(`polls \\(1\\):\n  ${poll}  open +1 voter +not voted  Attachment storage`),
    );
    const json = JSON.parse(repo.nav(["issue", "show", issue, "--json"]).stdout) as {
      polls: { id: string }[];
    };
    assert.deepEqual(
      json.polls.map((p) => p.id),
      [poll],
    );
    const other = openIssue(repo, "No poll here");
    const ids = (args: string[]) =>
      repo
        .nav(["issue", "list", ...args, "--json"])
        .stdout.split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { id: string }).id);
    assert.deepEqual(ids(["poll:open"]), [issue]);
    assert.deepEqual(ids(["poll:none"]), [other]);
    assert.deepEqual(ids(["poll-awaiting:nav@test.invalid"]), [issue]);
    assert.deepEqual(ids(["poll-awaiting:bob@example.com"]), []);
    const bad = repo.nav(["issue", "list", "poll:maybe"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /'poll:maybe' is not a poll state/);
  });
});

describe("nav poll edit, close and reopen", () => {
  let repo: TempRepo;
  let issue: string;
  let poll: string;
  before(() => {
    repo = makePollRepo();
    issue = openIssue(repo);
    poll = openPoll(repo, issue);
    assert.equal(repo.nav(["poll", "vote", poll, "--pick", "backend=s3", "--commit"], BOB).code, 0);
    assert.equal(
      repo.nav(["poll", "vote", poll, "--pick", "backend=disk", "--commit"], ANN).code,
      0,
    );
  });
  after(() => repo.cleanup());

  it("edits in the editor, says nothing changed when nothing did, and leaves an invalid edit as it was saved", () => {
    const same = repo.nav(["poll", "edit", poll], { EDITOR: repo.editor("true.sh", "true") });
    assert.equal(same.code, 0, same.stderr);
    assert.match(same.stdout, /^No change to /);
    const breaks = repo.nav(["poll", "edit", poll], {
      EDITOR: repo.editor("break.sh", `sed -i 's/^title: .*$/title: ""/' "$1"`),
    });
    assert.equal(breaks.code, 1);
    assert.match(breaks.stderr, /is no longer valid; it was left as you saved it/);
    assert.match(breaks.stderr, /'title' must be a non-empty string/);
    repo.git(["checkout", "-q", "--", "."]);
    const retitle = repo.nav(["poll", "edit", poll, "--commit"], {
      EDITOR: repo.editor("retitle.sh", `sed -i 's/^title: .*$/title: Storage/' "$1"`),
    });
    assert.equal(retitle.code, 0, retitle.stderr);
    assert.doesNotMatch(retitle.stdout, /revoked/);
    assert.match(lastMessage(repo), new RegExp(`^docs\\(poll\\): edit ${poll} on #${issue}`));
    assert.equal(shown(repo, poll).voters, 2);
  });

  it("revokes every vote when the questions change, and says so", () => {
    const edited = repo.nav(
      ["poll", "edit", poll, "--from", "-", "--commit"],
      undefined,
      DRAFT.replace("Local disk", "Local disks"),
    );
    assert.equal(edited.code, 0, edited.stderr);
    assert.match(edited.stdout, /The questions changed: 2 votes were revoked/);
    const json = shown(repo, poll, BOB);
    assert.equal(json.voters, 0);
    assert.equal(json.title, "Attachment storage", "--from replaces the title too");
    assert.equal((json.me as Record<string, unknown>).state, "revoked");
    const theirs = repo.nav(["poll", "show", poll], BOB);
    assert.match(theirs.stdout, /the questions changed since you voted; vote again/);
    assert.doesNotMatch(theirs.stdout, / \* /, "a revoked ballot's picks are not marked as theirs");
    assert.match(repo.nav(["poll", "list"], BOB).stdout, new RegExp(poll), "it waits on Bob again");
  });

  it("refuses to break a tie, closes with a decision, and refuses what a closed poll cannot take", () => {
    assert.equal(
      repo.nav(
        ["poll", "vote", poll, "--fresh", "--pick", "backend=s3", "--commit"],
        as("Bob", "bob@example.com", "2026-08-01T12:00:00Z"),
      ).code,
      0,
    );
    assert.equal(
      repo.nav(
        ["poll", "vote", poll, "--fresh", "--pick", "backend=disk", "--commit"],
        as("Ann", "ann@example.com", "2026-08-01T12:05:00Z"),
      ).code,
      0,
    );
    // After both votes: at the fixture's pinned instant they would be hours
    // ahead of the clock, and a close would make them late rather than tied.
    const tied = repo.nav(["poll", "close", poll], { NAV_NOW: "2026-08-01T12:10:00Z" });
    assert.equal(tied.code, 1);
    assert.match(tied.stderr, /has a tie only you can break/);
    assert.match(tied.stderr, /'backend' is tied between s3, disk/);
    const closed = repo.nav(
      [
        "poll",
        "close",
        poll,
        "--decide",
        "backend=2",
        "--decide",
        "limits=",
        "-m",
        "Disks are what we run.",
        "--commit",
      ],
      as("Ada", "ada@example.com", "2026-08-01T13:00:00Z"),
    );
    assert.equal(closed.code, 0, closed.stderr);
    assert.match(closed.stdout, /1\. Which storage backend\? {2}→ Local disks/);
    assert.match(closed.stdout, /2\. Which limits do we enforce\? {2}→ undecided/);
    assert.match(lastMessage(repo), new RegExp(`^docs\\(poll\\): close ${poll} on #${issue}`));
    const json = shown(repo, poll);
    assert.equal(json.status, "closed");
    assert.equal(json["closed-by"], "Ada <ada@example.com>");
    assert.deepEqual(json.decision, { backend: { picks: ["disk"], other: null } });
    assert.equal(json["decision-note"], "Disks are what we run.");
    const show = repo.nav(["poll", "show", poll]);
    assert.match(show.stdout, /closed 2026-08-01T13:00:00Z by Ada <ada@example\.com>; decided:/);
    assert.doesNotMatch(show.stdout, /hidden/, "a closed poll shows its results");
    const late = repo.nav(["poll", "vote", poll, "--pick", "backend=s3"], BOB);
    assert.equal(late.code, 1);
    assert.match(late.stderr, new RegExp(`poll ${poll} is closed; reopen it to vote`));
    assert.match(
      repo.nav(["poll", "edit", poll, "--from", "-"], undefined, DRAFT).stderr,
      /is closed; reopen it to edit it/,
    );
    assert.match(repo.nav(["poll", "list", "--state", "closed"]).stdout, new RegExp(poll));
  });

  it("reopens, clearing the decision", () => {
    const result = repo.nav(["poll", "reopen", poll, "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(lastMessage(repo), new RegExp(`^docs\\(poll\\): reopen ${poll} on #${issue}`));
    const json = shown(repo, poll);
    assert.equal(json.status, "open");
    assert.equal(json.decision, null);
    assert.equal(repo.nav(["poll", "reopen", poll]).code, 1);
  });

  it("leaves a clean doctor behind", () => {
    // Run when the suite's last act was, not at the fixture's pinned instant
    // before any of it: a vote stamped hours after the clock is X-poll-2's.
    const doctor = repo.nav(["doctor"], { NAV_NOW: "2026-08-01T13:00:00Z" });
    assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
    assert.doesNotMatch(doctor.stdout, /X-poll/);
  });
});

describe("the plugin, when it is not needed", () => {
  let repo: TempRepo;
  const log = (): string[] => {
    const path = join(repo.home, "trace.log");
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
    rmSync(path, { force: true });
    return lines;
  };
  const tracer = pathToFileURL(join(PLUGIN, "test", "trace-imports.mjs")).href;
  const traced = (...args: string[]) =>
    repo.nav(args, { NODE_OPTIONS: `--import=${tracer}`, TRACE_LOG: join(repo.home, "trace.log") });
  let issue: string;
  before(() => {
    repo = makePollRepo();
    issue = openIssue(repo);
    openPoll(repo, issue);
    log();
  });
  after(() => repo.cleanup());

  it("is not imported to list issues or pull requests, or to print help", () => {
    for (const args of [["issue", "list"], ["pr", "list"], ["--help"], ["poll", "--help"]]) {
      assert.equal(traced(...args).code, 0, args.join(" "));
      assert.deepEqual(log(), [], args.join(" "));
    }
  });

  it("is imported by its own commands, its query terms, an issue's show, and doctor", () => {
    traced("poll", "list", "--all");
    assert.ok(log().some((line) => line.startsWith("src/cli/")));
    traced("issue", "list", "poll:open");
    const term = log();
    assert.ok(term.some((line) => line.startsWith("src/core/")));
    assert.ok(!term.some((line) => line.startsWith("src/cli/")), term.join(" "));
    traced("issue", "show", issue);
    assert.ok(log().some((line) => line.startsWith("src/cli/")));
    traced("doctor");
    assert.ok(log().some((line) => line.startsWith("src/core/")));
  });

  it("leaves a tree it cannot read alone", () => {
    const bare = repo.nav(["doctor"], { NAVBOOK_PLUGIN_PATH: "" });
    assert.equal(bare.code, 0, bare.stdout + bare.stderr);
    assert.match(bare.stderr, /@navbook\/plugin-poll/);
    const close = repo.nav(["issue", "close", issue, "--commit"], { NAVBOOK_PLUGIN_PATH: "" });
    assert.equal(close.code, 0, close.stderr);
    const moved = repo.git(["ls-files", ".navbook/issues/closed"]).stdout;
    assert.match(
      moved,
      /\/poll\/[a-z0-9]{8}-attachment-storage\/poll\.md$/m,
      "the poll went with its issue",
    );
  });
});
