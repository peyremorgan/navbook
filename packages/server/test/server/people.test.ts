/**
 * Who the repository says it knows.
 *
 * The three sources are separated deliberately here, because each of them is a
 * different claim: the history is what a terminal user did, the tree is what
 * anybody wrote down, and the viewer is whoever is asking. The fixture's own
 * committer is the machine account, so it stands for the deployment's — which
 * makes "absent from history, present through the tree" a case this suite can
 * actually make.
 *
 * The tests share one repository and run in order, each adding to what the one
 * before it established.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";
import { FIXTURE_IDENTITY } from "../helpers/temprepo.ts";

const PEOPLE = `query { people }`;

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id } }
}`;

/** The default token's person: what every request here is signed as. */
const VIEWER = "A Person <person@example.invalid>";
const MACHINE = `${FIXTURE_IDENTITY.name} <${FIXTURE_IDENTITY.email}>`;

describe("people", () => {
  let h: Harness;

  const people = async (auth?: string): Promise<string[]> =>
    ok<{ people: string[] }>(await h.gql(PEOPLE, undefined, auth)).people;

  /** A commit from a terminal, authored by somebody, and pushed. */
  const pushCommit = (name: string, email: string, file: string): void => {
    h.fixture.peer.git(["pull", "--quiet", "--ff-only"]);
    h.fixture.peer.write(file, `${file}\n`);
    h.fixture.peer.commitAll(`chore: write ${file}`, {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
    });
    const pushed = h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]);
    assert.equal(pushed.code, 0, pushed.stderr);
  };

  before(async () => {
    // Every read fetches, so a push from the peer is visible to the next
    // request rather than to the one after the staleness window.
    h = await startHarness({ pullIntervalMs: 0 });
  });

  after(async () => {
    await h.stop();
  });

  it("says the viewer, and not the account the server commits as", async () => {
    // The only commit so far is the fixture's own, authored by the machine
    // account: a history of nothing but the gateway names nobody.
    assert.deepEqual(await people(), [VIEWER]);
  });

  it("says somebody who committed from a terminal", async () => {
    pushCommit("Peer Person", "peer@test.invalid", "one.txt");
    assert.deepEqual(await people(), [
      "A Person <person@example.invalid>",
      "Peer Person <peer@test.invalid>",
    ]);
  });

  it("notices the next commit, having already walked the one before", async () => {
    pushCommit("Second Peer", "second@test.invalid", "two.txt");
    assert.deepEqual(await people(), [
      VIEWER,
      "Peer Person <peer@test.invalid>",
      "Second Peer <second@test.invalid>",
    ]);
  });

  it("says the machine account once a file names it, though its commits do not", async () => {
    // Filed from a terminal, so `author:` is that clone's git identity — which
    // is the machine account. Absent as a committer, present as an author.
    h.fixture.peer.git(["pull", "--quiet", "--ff-only"]);
    h.fixture.peer.fileIssue("Filed at a terminal", "Body.", "pe111111");
    const pushed = h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]);
    assert.equal(pushed.code, 0, pushed.stderr);

    assert.ok((await people()).includes(MACHINE));
  });

  it("says somebody only a file names, the moment the file says it", async () => {
    ok(
      await h.gql(OPEN, {
        input: {
          title: "Assigned to a stranger",
          body: "Body.",
          assignees: ["Zed <zed@example.invalid>"],
        },
      }),
    );
    assert.ok((await people()).includes("Zed <zed@example.invalid>"));
  });

  it("names a person as their newest commit does, whatever a file calls them", async () => {
    // The same address, spelled differently and under another name, on a newer
    // commit and in a file written after it.
    pushCommit("Peer Renamed", "PEER@test.invalid", "three.txt");
    ok(
      await h.gql(OPEN, {
        input: {
          title: "Assigned under an older name",
          body: "Body.",
          assignees: ["Peer Was Called This <peer@test.invalid>"],
        },
      }),
    );

    const theirs = (await people()).filter((person) =>
      person.toLowerCase().includes("peer@test.invalid"),
    );
    // One person, named and spelled as the newest commit had it.
    assert.deepEqual(theirs, ["Peer Renamed <PEER@test.invalid>"]);
  });

  it("answers about whoever is asking", async () => {
    const stranger = "bare@example.invalid";
    const listed = await people(await h.token({ email: stranger, name: "" }));
    assert.ok(listed.includes(stranger), listed.join(", "));

    // Nobody else's request is about them: the viewer is the one source of the
    // three that arrives with the token rather than with the repository.
    assert.ok(!(await people()).includes(stranger));
  });

  it("says each person once, sorted by what is shown", async () => {
    const listed = await people();
    const key = (person: string): string => {
      const named = /^(.*?)\s*<([^<>]+)>$/.exec(person);
      return (named ? (named[1] as string) : person).toLowerCase();
    };
    assert.deepEqual(
      [...listed].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
      listed,
    );
    assert.equal(new Set(listed.map((person) => person.toLowerCase())).size, listed.length);
  });
});
