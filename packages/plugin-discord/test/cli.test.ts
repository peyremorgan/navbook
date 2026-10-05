/**
 * `nav discord` and the doctor check, through the real `nav`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeNavRepo, type TempRepo } from "@navbook/cli/test-helpers";
import { PLUGIN } from "./helpers/bridge.ts";

const GUILD = "100000000000000001";
const ALICE = "111111111111111111";
const ALICE_TOO = "111111111111111112";
const BOB = "222222222222222222";

const env = { NAVBOOK_PLUGIN_PATH: PLUGIN };

/** A repository that declares the plugin with `settings`, committed. */
function declared(
  settings: Record<string, unknown> = { guild: GUILD },
  extra: Record<string, unknown> = {},
): TempRepo {
  const repo = makeNavRepo();
  const marker = { version: 1, ...extra, plugins: { "@navbook/plugin-discord": settings } };
  repo.write(".navbook/navbook.json", `${JSON.stringify(marker, null, 2)}\n`);
  repo.git(["add", "-A"]);
  repo.git(["commit", "--quiet", "-m", "chore: declare the bridge"]);
  return repo;
}

function marker(repo: TempRepo): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repo.dir, ".navbook", "navbook.json"), "utf8"));
}

function people(repo: TempRepo): unknown {
  const plugins = marker(repo).plugins as Record<string, Record<string, unknown>>;
  return plugins["@navbook/plugin-discord"]?.people;
}

function subjects(repo: TempRepo): string[] {
  return repo.git(["log", "--format=%s"]).stdout.split("\n").filter(Boolean);
}

describe("nav discord link", () => {
  it("records the link and commits it under the plugin's scope", () => {
    const repo = declared();
    const linked = repo.nav(["discord", "link", ALICE, "alice@example.com", "--commit"], env);
    assert.equal(linked.code, 0, linked.stderr);
    assert.match(linked.stdout, new RegExp(`Linked Discord user ${ALICE} to alice@example.com`));
    assert.match(linked.stdout, /Committed docs\(discord\): link alice@example\.com/);
    assert.deepEqual(people(repo), { [ALICE]: "alice@example.com" });
    assert.equal(subjects(repo)[0], "docs(discord): link alice@example.com");
    assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
  });

  it("says when there is nothing to change, and commits nothing", () => {
    const repo = declared();
    repo.nav(["discord", "link", ALICE, "alice@example.com", "--commit"], env);
    const again = repo.nav(["discord", "link", ALICE, "alice@example.com", "--commit"], env);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /already linked/);
    assert.equal(subjects(repo).filter((subject) => subject.startsWith("docs(discord)")).length, 1);
  });

  it("leaves everything else in the marker as it was", () => {
    const repo = declared(
      { guild: GUILD, prs: { channel: "100000000000000002" } },
      { review: { minApprovals: 2 } },
    );
    const before = marker(repo);
    assert.equal(repo.nav(["discord", "link", BOB, "bob@example.com"], env).code, 0);
    const after = marker(repo);
    assert.deepEqual(Object.keys(after), Object.keys(before));
    assert.deepEqual(after.review, { minApprovals: 2 });
    const settings = (after.plugins as Record<string, Record<string, unknown>>)[
      "@navbook/plugin-discord"
    ];
    assert.deepEqual(settings, {
      guild: GUILD,
      prs: { channel: "100000000000000002" },
      people: { [BOB]: "bob@example.com" },
    });
    // Without --commit, written and left for the person to commit.
    assert.match(repo.git(["status", "--porcelain"]).stdout, /navbook\.json/);
  });

  it("refuses what is not a Discord id or a bare address", () => {
    const repo = declared();
    const id = repo.nav(["discord", "link", "alice", "alice@example.com"], env);
    assert.equal(id.code, 1);
    assert.match(id.stderr, /"alice" is not a Discord user id/);
    const named = repo.nav(["discord", "link", ALICE, "Alice <alice@example.com>"], env);
    assert.equal(named.code, 1);
    assert.match(named.stderr, /is not an email address/);
    assert.equal(people(repo), undefined);
  });

  it("refuses a repository that does not declare the plugin", () => {
    const repo = makeNavRepo();
    const result = repo.nav(["discord", "link", ALICE, "alice@example.com"], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not declare @navbook\/plugin-discord/);
  });
});

describe("nav discord unlink", () => {
  it("forgets one account by its id, or every account of an address", () => {
    const repo = declared();
    repo.nav(["discord", "link", ALICE, "alice@example.com"], env);
    repo.nav(["discord", "link", ALICE_TOO, "Alice@Example.com"], env);
    repo.nav(["discord", "link", BOB, "bob@example.com"], env);

    const one = repo.nav(["discord", "unlink", BOB, "--commit"], env);
    assert.equal(one.code, 0, one.stderr);
    assert.match(one.stdout, new RegExp(`Unlinked Discord user ${BOB} from bob@example.com`));
    assert.equal(subjects(repo)[0], "docs(discord): unlink bob@example.com");

    const both = repo.nav(["discord", "unlink", "alice@example.com"], env);
    assert.equal(both.code, 0, both.stderr);
    assert.match(both.stdout, new RegExp(`${ALICE}.*${ALICE_TOO}`));
    // An emptied map is removed rather than left as {}.
    assert.equal(people(repo), undefined);
  });

  it("says plainly when there is nothing to forget", () => {
    const repo = declared();
    assert.match(repo.nav(["discord", "unlink", BOB], env).stderr, /is not linked/);
    assert.match(
      repo.nav(["discord", "unlink", "bob@example.com"], env).stderr,
      /no Discord account is linked/,
    );
    assert.match(
      repo.nav(["discord", "unlink", "nobody"], env).stderr,
      /neither a Discord user id nor an email/,
    );
  });
});

describe("nav discord people", () => {
  it("lists the links, as a table or as JSON", () => {
    const repo = declared();
    assert.match(repo.nav(["discord", "people"], env).stdout, /No Discord accounts are linked/);
    assert.equal(repo.nav(["discord", "people", "--json"], env).stdout, "");
    repo.nav(["discord", "link", ALICE, "alice@example.com"], env);
    const table = repo.nav(["discord", "people"], env);
    assert.equal(table.code, 0, table.stderr);
    assert.match(table.stdout, new RegExp(`${ALICE}\\s+alice@example\\.com`));
    const json = repo.nav(["discord", "people", "--json"], env).stdout.trim().split("\n");
    assert.deepEqual(
      json.map((line) => JSON.parse(line)),
      [{ discordUserId: ALICE, email: "alice@example.com" }],
    );
  });
});

describe("nav doctor", () => {
  it("names each fault in the settings, by the key it is about", () => {
    const repo = declared({
      guild: "general",
      issues: [{ channel: "100000000000000003", on: ["closed"] }],
      people: { [ALICE]: "Alice <alice@example.com>" },
    });
    const doctor = repo.nav(["doctor"], env);
    assert.notEqual(doctor.code, 0);
    assert.match(
      doctor.stdout + doctor.stderr,
      /X-discord-1.*guild: "general" is not a Discord id/,
    );
    assert.match(
      doctor.stdout + doctor.stderr,
      /issues\[0\]\.on\[0\]: "closed" is not a trigger; use "status:closed"/,
    );
    assert.match(
      doctor.stdout + doctor.stderr,
      new RegExp(`people\\.${ALICE}: .* is not an email address`),
    );
  });

  it("is quiet about settings that read", () => {
    const repo = declared({
      guild: GUILD,
      url: "https://tracker.example",
      prs: { channel: "100000000000000002" },
      issues: [
        {
          channel: "100000000000000003",
          scope: "root",
          on: ["open", "field:priority=high"],
          match: "label:bug",
        },
      ],
      people: { [ALICE]: "alice@example.com" },
    });
    const doctor = repo.nav(["doctor"], env);
    assert.doesNotMatch(doctor.stdout + doctor.stderr, /X-discord-1/);
  });
});
