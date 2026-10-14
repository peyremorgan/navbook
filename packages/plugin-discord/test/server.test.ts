/**
 * The bridge in a real server: threads opened, told and archived as the
 * tracker moves — whether it moves over the API or by somebody's push.
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  type Harness,
  makeFixture,
  ok,
  originSubjects,
  startHarness,
} from "@navbook/server/test-helpers";
import { eventually, markerWith, PLUGIN, SETTINGS, startBridged } from "./helpers/bridge.ts";
import {
  ELSEWHERE,
  FORUM,
  GUILD,
  type StubDiscord,
  startStubDiscord,
  TEXT,
  VOICE,
} from "./helpers/stub-discord.ts";
import {
  closeIssue,
  comment,
  openIssue,
  peerComment,
  peerDropBranch,
  peerEdit,
  peerMerge,
  recordPath,
  reopenIssue,
  updateIssue,
} from "./helpers/tracker.ts";

const ALICE = "111111111111111111";

const OPEN_ISSUE = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "It does not work." }) { issue { id } } }`;

describe("threads", () => {
  it("opens one for an issue opened over the API, with its card", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const opened = ok(
        await harness.gql<{ openIssue: { issue: { id: string } } }>(OPEN_ISSUE, {
          title: "Login is broken",
        }),
      );
      const id = opened.openIssue.issue.id;
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const [thread] = stub.threadsOf(TEXT);
      assert.equal(thread?.name, `#${id} Login is broken`);
      const card = stub.card(thread?.id as string);
      assert.equal(card?.embeds[0]?.footer?.text, `navbook:${id}`);
      assert.equal(card?.embeds[0]?.url, `https://tracker.example/issues/${id}`);
      assert.match(card?.embeds[0]?.description ?? "", /It does not work\./);
    } finally {
      await bridged.stop();
    }
  });

  it("opens a forum post for a pull request somebody pushed from a terminal", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Fix the login", "Retries once.", "pr111111", "fix-login");
      assert.equal(peer.git(["push", "--quiet", "origin", "fix-login"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      assert.equal(stub.threadsOf(FORUM)[0]?.name, "#pr111111 Fix the login");
      assert.equal(stub.threadsOf(TEXT).length, 0);
    } finally {
      await bridged.stop();
    }
  });
});

/** The text of every message posted in a thread after its card. */
function said(stub: StubDiscord, thread: string): string[] {
  return stub.posts(thread).map((message) => message.content);
}

/** The thread the bridge says a record has, through the API, or null. */
async function bridgedThread(h: Harness, ref: string): Promise<string | null> {
  const read = ok(
    await h.gql<{ discord: { thread: { id: string } | null } }>(
      "query Q($ref: ID!) { discord { thread(ref: $ref) { id } } }",
      { ref },
    ),
  );
  return read.discord.thread?.id ?? null;
}

/** Wait until the bridge says `thread` is the record's, as it does once it took it. */
async function taken(h: Harness, ref: string, thread: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while ((await bridgedThread(h, ref)) !== thread) {
    if (Date.now() > deadline) assert.fail(`never taken:\n${h.stderr()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The thread a record got in a channel, by the id its name starts with. */
function threadOf(stub: StubDiscord, channel: string, id: string): string {
  const thread = stub.threadsOf(channel).find((each) => each.name?.startsWith(`#${id} `));
  if (thread === undefined) throw new Error(`#${id} has no thread in ${channel}`);
  return thread.id;
}

describe("telling a thread", () => {
  it("tells it of comments, assignments, closing and reopening, and keeps its card", async () => {
    const people = { [ALICE]: "alice@example.com" };
    const bridged = await startBridged({ settings: { ...SETTINGS, people } });
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Login is broken");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);

      await comment(harness, "ISSUE", id, "Reproduced on staging.");
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.match(
        said(stub, thread)[0] ?? "",
        /^💬 \*\*.+\*\* commented:\n> Reproduced on staging\.$/,
      );
      const counted = () =>
        stub.card(thread)?.embeds[0]?.fields?.find((field) => field.name === "Comments")?.value;
      await eventually(
        () => counted() === "1",
        () => JSON.stringify(stub.card(thread)),
      );

      await updateIssue(harness, id, { assignees: ["Alice Smith <alice@example.com>"] });
      await eventually(
        () => said(stub, thread).length === 2,
        () => harness.stderr(),
      );
      const assigned = stub.posts(thread)[1];
      assert.equal(assigned?.content, `👤 Assigned to <@${ALICE}>.`);
      assert.deepEqual(assigned?.allowed_mentions, { parse: [], users: [ALICE] });

      await closeIssue(harness, id, "fixed");
      await eventually(
        () => stub.channels.get(thread)?.thread_metadata?.archived === true,
        () => harness.stderr(),
      );
      assert.equal(said(stub, thread).at(-1), "🔒 Closed as fixed.");
      assert.equal(stub.card(thread)?.embeds[0]?.fields?.[0]?.value, "Closed · fixed");
      assert.deepEqual(
        (
          stub.card(thread)?.components[0] as { components: { label: string }[] } | undefined
        )?.components.map((b) => b.label),
        ["Comment", "Reopen"],
      );

      await reopenIssue(harness, id);
      await eventually(
        () => said(stub, thread).at(-1) === "🔓 Reopened.",
        () => harness.stderr(),
      );
      assert.equal(stub.channels.get(thread)?.thread_metadata?.archived, false);
    } finally {
      await bridged.stop();
    }
  });

  it("renames it when the record is retitled, and hears of a push from a terminal", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Login is broken");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      await updateIssue(harness, id, { title: "Login times out on 3G" });
      await eventually(
        () => stub.channels.get(thread)?.name === `#${id} Login times out on 3G`,
        () => harness.stderr(),
      );
      assert.equal(
        said(stub, thread).at(-1),
        "✏️ Retitled: “Login is broken” → “Login times out on 3G”.",
      );

      peerComment(harness, "issue", id, "Seen it too, from a terminal.");
      await eventually(
        () => said(stub, thread).some((line) => line.includes("Seen it too")),
        () => harness.stderr(),
      );
      assert.match(said(stub, thread).at(-1) ?? "", /^💬 \*\*Peer Person\*\* commented:/);
    } finally {
      await bridged.stop();
    }
  });
});

describe("a pull request's thread", () => {
  it("is told of reviews on its branch, then of its merge, and archived", async () => {
    const bridged = await startBridged({
      settings: { ...SETTINGS, people: { [ALICE]: "reviewer@example.com" } },
    });
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Fix the login", "Retries once.", "pr111111", "fix-login");
      assert.equal(peer.git(["push", "--quiet", "origin", "fix-login"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, FORUM, "pr111111");

      peerEdit(
        harness,
        recordPath(harness, "pr111111", "fix-login"),
        (text) =>
          text.replace("---\n\n", "reviewer: Rita Reviewer <reviewer@example.com>\n---\n\n"),
        { branch: "fix-login", message: "docs(pr): request review #pr111111" },
      );
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, thread)[0], `👀 Review requested from <@${ALICE}>.`);
      assert.deepEqual(stub.posts(thread)[0]?.allowed_mentions, { parse: [], users: [ALICE] });

      const head = peer.git(["rev-parse", "origin/fix-login~1"]).stdout.trim();
      const revisions = stub
        .card(thread)
        ?.embeds[0]?.fields?.find((field) => field.name === "Reviews");
      assert.equal(revisions?.value, `⏳ <@${ALICE}>`);
      peerComment(harness, "pr", "pr111111", "Ship it.", {
        branch: "fix-login",
        author: "Rita Reviewer <reviewer@example.com>",
        verdict: "approve",
        revision: readHead(harness) ?? head,
      });
      await eventually(
        () => said(stub, thread).length === 2,
        () => harness.stderr(),
      );
      assert.equal(
        said(stub, thread)[1],
        `✅ **<@${ALICE}>** approved this pull request:\n> Ship it.`,
      );

      peerMerge(harness, "fix-login", "pr111111");
      await eventually(
        () => stub.channels.get(thread)?.thread_metadata?.archived === true,
        () => harness.stderr(),
      );
      assert.equal(said(stub, thread).at(-1), "🟣 Merged.");
      assert.equal(stub.card(thread)?.embeds[0]?.fields?.[0]?.value, "Merged");
    } finally {
      await bridged.stop();
    }
  });

  it("is told when its branch is gone without a merge", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Try something", "Maybe.", "pr222222", "experiment");
      assert.equal(peer.git(["push", "--quiet", "origin", "experiment"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, FORUM, "pr222222");
      peerDropBranch(harness, "experiment");
      await eventually(
        () => stub.channels.get(thread)?.thread_metadata?.archived === true,
        () => harness.stderr(),
      );
      assert.equal(
        said(stub, thread).at(-1),
        "🗑️ This pull request is no longer on any branch the tracker can see.",
      );
    } finally {
      await bridged.stop();
    }
  });
});

/** The pull request's latest revision on origin's copy of its branch. */
function readHead(h: Harness): string | null {
  const { peer } = h.fixture;
  const path = peer
    .git(["ls-tree", "-r", "--name-only", "origin/fix-login", ".navbook/prs/open/"])
    .stdout.split("\n")
    .find((each) => each.endsWith("/pr.md"));
  if (path === undefined) return null;
  const text = peer.git(["show", `origin/fix-login:${path}`]).stdout;
  return /head: ([0-9a-f]{40})/.exec(text)?.[1] ?? null;
}

describe("the rules", () => {
  const settings = {
    ...SETTINGS,
    people: { [ALICE]: "alice@example.com" },
    issues: [
      { channel: TEXT, scope: "root", on: ["assign"] },
      { channel: TEXT, on: ["status:closed"], match: "label:bug" },
      { channel: TEXT, on: ["field:priority=high"] },
    ],
  };

  it("open a thread when a trigger fires, in scope, matching the query — and not otherwise", async () => {
    const bridged = await startBridged({ settings });
    const { stub, harness } = bridged;
    try {
      // Unassigned: no rule fires. Its subtask, assigned: out of `root`'s scope.
      const quiet = await openIssue(harness, "Nobody on it yet");
      ok(
        await harness.gql(
          `mutation { openIssue(input: { title: "A part of it", body: "Sub.", parent: "${quiet}", assignees: ["alice@example.com"] }) { issue { id } } }`,
        ),
      );
      // Assigned from the start: fires `assign` on first sight, and pings.
      const assigned = await openIssue(harness, "On it", {
        assignees: ["Alice Smith <alice@example.com>"],
      });
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, assigned);
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, thread)[0], `👤 Assigned to <@${ALICE}>.`);

      // Assigned later: fires then.
      await updateIssue(harness, quiet, { assignees: ["alice@example.com"] });
      await eventually(
        () => stub.threadsOf(TEXT).length === 2,
        () => harness.stderr(),
      );
      const later = threadOf(stub, TEXT, quiet);
      await eventually(
        () => said(stub, later).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, later)[0], `👤 Assigned to <@${ALICE}>.`);

      // Closed, and a bug: the second rule. Closed, and not one: none.
      const bug = await openIssue(harness, "Crash");
      await updateIssue(harness, bug, { labels: ["bug"] });
      const chore = await openIssue(harness, "Tidy up");
      await closeIssue(harness, chore, "fixed");
      await closeIssue(harness, bug, "fixed");
      await eventually(
        () => stub.threadsOf(TEXT).length === 3,
        () => harness.stderr(),
      );
      const closed = threadOf(stub, TEXT, bug);
      await eventually(
        () => said(stub, closed).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, closed)[0], "🔒 Closed as fixed.");
      assert.equal(stub.card(closed)?.embeds[0]?.fields?.[0]?.value, "Closed · fixed");
      assert.equal(
        stub.threadsOf(TEXT).some((each) => each.name?.startsWith(`#${chore} `)),
        false,
      );

      // A custom field given at a terminal: the third rule, and it is told.
      const watched = await openIssue(harness, "Slow page");
      peerEdit(harness, recordPath(harness, watched), (text) =>
        text.replace("---\n\n", "priority: high\n---\n\n"),
      );
      await eventually(
        () => stub.threadsOf(TEXT).length === 4,
        () => harness.stderr(),
      );
      const field = threadOf(stub, TEXT, watched);
      await eventually(
        () => said(stub, field).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, field)[0], "🏷️ **priority**: — → high.");
    } finally {
      await bridged.stop();
    }
  });
});

describe("what the bridge keeps across a restart", () => {
  it("tells what happened while it was down, once, and makes no thread twice", async () => {
    const stub = await startStubDiscord();
    const fixture = makeFixture({ marker: markerWith(SETTINGS) });
    try {
      const first = await startBridged({ stub, harness: { fixture } });
      const id = await openIssue(first.harness, "Before the restart");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => first.harness.stderr(),
      );
      await first.stop();

      // Meanwhile, at a terminal: a comment on it, and a new issue.
      peerComment(first.harness, "issue", id, "Said while the server was down.");
      fixture.peer.fileIssue("Filed while it was down", "Body.", "down1111");
      assert.equal(fixture.peer.git(["push", "--quiet", "origin", "main"]).code, 0);

      const second = await startBridged({ stub, harness: { fixture } });
      try {
        const thread = threadOf(stub, TEXT, id);
        await eventually(
          () => stub.threadsOf(TEXT).length === 2,
          () => second.harness.stderr(),
        );
        await eventually(
          () => said(stub, thread).length === 1,
          () => second.harness.stderr(),
        );
        assert.match(said(stub, thread)[0] ?? "", /Said while the server was down/);
        assert.ok(
          stub.threadsOf(TEXT).some((each) => each.name === "#down1111 Filed while it was down"),
        );
      } finally {
        await second.stop();
      }

      // Its state lost: it starts from what is there, and finds its threads.
      rmSync(join(fixture.server.dir, ".git", "navbook", "discord.json"));
      const third = await startBridged({ stub, harness: { fixture } });
      try {
        assert.match(third.harness.stderr(), /found 2 threads the bridge made before/);
        await comment(third.harness, "ISSUE", id, "After the state was lost.");
        const thread = threadOf(stub, TEXT, id);
        await eventually(
          () => said(stub, thread).length === 2,
          () => third.harness.stderr(),
        );
        assert.equal(stub.threadsOf(TEXT).length, 2, "made a thread twice");
      } finally {
        await third.stop();
      }
    } finally {
      fixture.cleanup();
      await stub.close();
    }
  });
});

describe("when Discord fails", () => {
  it("tries a failed message again, and posts it once", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Flaky");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      stub.fail("POST", new RegExp(`^/channels/${thread}/messages$`), 502);
      await comment(harness, "ISSUE", id, "Lost the first time.");
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.match(harness.stderr(), /could not tell the thread of #\w{8}: Discord answered 502/);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(said(stub, thread).length, 1);
    } finally {
      await bridged.stop();
    }
  });

  it("passes over what Discord refuses for good, and forgets a deleted thread", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Refused");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      stub.fail("POST", new RegExp(`^/channels/${thread}/messages$`), 403, {
        body: { message: "Missing Permissions", code: 50013 },
      });
      await comment(harness, "ISSUE", id, "Not allowed to say this.");
      await eventually(
        () => /Discord refused what #\w{8} needed, and it is passed over/.test(harness.stderr()),
        () => harness.stderr(),
      );
      await comment(harness, "ISSUE", id, "But this.");
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.match(said(stub, thread)[0] ?? "", /But this/);

      stub.deleteThread(thread);
      await comment(harness, "ISSUE", id, "Into the void.");
      await eventually(
        () => /the thread of #\w{8} is gone from Discord/.test(harness.stderr()),
        () => harness.stderr(),
      );
      await comment(harness, "ISSUE", id, "Still nothing.");
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(stub.threadsOf(TEXT).length, 0, "made the deleted thread again");
    } finally {
      await bridged.stop();
    }
  });
});

const ALICE_USER = { id: ALICE, username: "alice", global_name: "Alice" };
const BOB = "222222222222222222";
const BOB_USER = { id: BOB, username: "bob", global_name: "Bob" };

/** `/nav <sub>` typed in `channel`. */
function slash(
  stub: StubDiscord,
  user: typeof ALICE_USER,
  sub: string,
  options: Record<string, string> = {},
  channel?: string,
) {
  return stub.interact({
    type: 2,
    ...(channel === undefined ? {} : { channel_id: channel }),
    member: { user },
    data: {
      type: 1,
      name: "nav",
      options: [
        {
          type: 1,
          name: sub,
          options: Object.entries(options).map(([name, value]) => ({ type: 3, name, value })),
        },
      ],
    },
  });
}

function press(stub: StubDiscord, user: typeof ALICE_USER, customId: string, channel?: string) {
  return stub.interact({
    type: 3,
    ...(channel === undefined ? {} : { channel_id: channel }),
    member: { user },
    data: { custom_id: customId },
  });
}

function submit(
  stub: StubDiscord,
  user: typeof ALICE_USER,
  customId: string,
  fields: Record<string, string>,
) {
  return stub.interact({
    type: 5,
    member: { user },
    data: {
      custom_id: customId,
      components: Object.entries(fields).map(([id, value]) => ({
        type: 18,
        component: { type: 4, custom_id: id, value },
      })),
    },
  });
}

/** What the bridge finally said to an interaction: its reply, or the edit of its deferral. */
async function answer(stub: StubDiscord, interaction: { id: string }): Promise<string> {
  const [first] = await stub.answers(interaction.id);
  if (first?.type === 5) {
    const [, edited] = await stub.answers(interaction.id, 2);
    return (edited?.data as { content: string } | undefined)?.content ?? "";
  }
  return (first?.data as { content?: string } | undefined)?.content ?? "";
}

/** Comments on a record, as the API reads them. */
async function commentsOf(h: Harness, kind: "issue" | "pr", id: string) {
  const result = ok(
    await h.gql<
      Record<
        string,
        {
          comments: {
            author: string;
            body: string;
            verdict: string | null;
            revision: string | null;
          }[];
        }
      >
    >(`query Q($ref: ID!) { ${kind}(ref: $ref) { comments { author body verdict revision } } }`, {
      ref: id,
    }),
  );
  return result[kind]?.comments ?? [];
}

describe("commands", () => {
  it("link an account through the web tracker, then act as its person", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const id = await openIssue(harness, "Linked commenting");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);

      assert.match(await answer(stub, slash(stub, ALICE_USER, "whoami")), /not linked/);
      const refused = slash(stub, ALICE_USER, "comment", { body: "Too soon." }, thread);
      assert.match(await answer(stub, refused), /not linked to anybody/);

      const offered = await answer(stub, slash(stub, ALICE_USER, "link"));
      const code = /discord\/link\?code=([A-Z0-9]{8})/.exec(offered)?.[1];
      assert.ok(code, offered);
      const [reply] = await stub.answers(stub.responses.at(-1)?.interaction as string);
      assert.equal(
        (reply?.data as { flags: number } | undefined)?.flags,
        64,
        "a code is shown to its owner only",
      );

      const alice = await harness.token({ name: "Alice Smith", email: "alice@example.com" });
      const linked = ok(
        await harness.gql<{
          linkDiscord: {
            link: { userId: string; username: string };
            commit: { committed: boolean; pushed: boolean };
          };
        }>(
          "mutation L($code: String!) { linkDiscord(code: $code) { link { userId username } commit { committed pushed } } }",
          { code: code.toLowerCase() },
          alice,
        ),
      );
      assert.deepEqual(linked.linkDiscord, {
        link: { userId: ALICE, username: "Alice" },
        commit: { committed: true, pushed: true },
      });
      assert.equal(
        originSubjects(harness.fixture.origin)[0],
        "docs(discord): link alice@example.com",
      );
      const again = await harness.gql(
        "mutation L($code: String!) { linkDiscord(code: $code) { link { userId } } }",
        { code },
        alice,
      );
      assert.equal(again.errors[0]?.extensions?.code, "INVALID_INPUT");
      const viewer = ok(
        await harness.gql<{ viewer: { discord: { userId: string }[] } }>(
          "{ viewer { discord { userId } } }",
          undefined,
          alice,
        ),
      );
      assert.deepEqual(viewer.viewer.discord, [{ userId: ALICE }]);

      // The bridge reads the link from the commit, at its next run.
      let whoami = "";
      for (let tries = 0; tries < 40 && !/acts as/.test(whoami); tries++) {
        whoami = await answer(stub, slash(stub, ALICE_USER, "whoami"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(whoami, /acts as alice@example\.com/);

      const typed = slash(stub, ALICE_USER, "comment", { body: "Said in Discord." }, thread);
      assert.equal(await answer(stub, typed), `Commented on #${id}.`);
      const comments = await commentsOf(harness, "issue", id);
      assert.deepEqual(
        comments.map((each) => [each.author, each.body.trim()]),
        [["alice@example.com", "Said in Discord."]],
      );
      await eventually(
        () => said(stub, thread).some((line) => line.includes("Said in Discord.")),
        () => harness.stderr(),
      );

      // Without a body, a form: the comment is what is typed into it.
      const formed = slash(stub, ALICE_USER, "comment", {}, thread);
      const [modal] = await stub.answers(formed.id);
      assert.equal(modal?.type, 9);
      assert.equal(
        (modal?.data as { custom_id: string } | undefined)?.custom_id,
        `nav:m-comment:${id}`,
      );
      const sent = submit(stub, ALICE_USER, `nav:m-comment:${id}`, { body: "Typed in a form." });
      assert.equal(await answer(stub, sent), `Commented on #${id}.`);

      const unlinked = slash(stub, ALICE_USER, "unlink");
      assert.match(await answer(stub, unlinked), /no longer acts as alice@example\.com/);
      assert.equal(
        originSubjects(harness.fixture.origin)[0],
        "docs(discord): unlink alice@example.com",
      );
    } finally {
      await bridged.stop();
    }
  });

  it("review from a card, bound to the revision it showed, on the pull request's branch", async () => {
    const bridged = await startBridged({
      settings: { ...SETTINGS, people: { [BOB]: "bob@example.com" } },
    });
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const { peer } = harness.fixture;
      peer.filePr("Fix the login", "Retries once.", "pr111111", "fix-login");
      assert.equal(peer.git(["push", "--quiet", "origin", "fix-login"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, FORUM, "pr111111");
      const buttons = (
        stub.card(thread)?.components[0] as { components: { custom_id: string }[] } | undefined
      )?.components;
      const approve = buttons?.[0]?.custom_id as string;
      assert.match(approve, /^nav:approve:pr111111:[0-9a-f]{12}$/);

      const [modal] = await stub.answers(press(stub, BOB_USER, approve, thread).id);
      assert.equal(modal?.type, 9);
      const modalId = (modal?.data as { custom_id: string } | undefined)?.custom_id;
      assert.equal(modalId, approve.replace("nav:approve:", "nav:m-approve:"));

      const stale = submit(stub, BOB_USER, "nav:m-approve:pr111111:0123456789ab", {
        body: "Old news.",
      });
      assert.match(await answer(stub, stale), /newer revision than the card you pressed showed/);

      const approved = submit(stub, BOB_USER, modalId, { body: "Looks right." });
      assert.equal(await answer(stub, approved), "Approved #pr111111.");
      peer.git(["fetch", "--quiet", "origin"]);
      assert.equal(
        peer.git(["log", "-1", "--format=%s", "origin/fix-login"]).stdout.trim(),
        "docs(pr): review #pr111111",
      );
      const reviews = await commentsOf(harness, "pr", "pr111111");
      assert.equal(reviews[0]?.verdict, "APPROVE");
      assert.equal(reviews[0]?.revision?.slice(0, 12), approve.slice(-12));
      await eventually(
        () => said(stub, thread).some((line) => line.startsWith("✅")),
        () => harness.stderr(),
      );
      assert.equal(
        said(stub, thread).at(-1),
        `✅ **<@${BOB}>** approved this pull request:\n> Looks right.`,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("assign, close and reopen, from buttons and commands", async () => {
    const bridged = await startBridged({
      settings: { ...SETTINGS, people: { [ALICE]: "alice@example.com", [BOB]: "bob@example.com" } },
    });
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const id = await openIssue(harness, "Needs an owner");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);

      assert.equal(
        await answer(stub, press(stub, ALICE_USER, `nav:assign-me:${id}`, thread)),
        `Assigned alice@example.com to #${id}.`,
      );
      await eventually(
        () => said(stub, thread).includes(`👤 Assigned to <@${ALICE}>.`),
        () => harness.stderr(),
      );
      const bob = stub.interact({
        type: 2,
        channel_id: thread,
        member: { user: ALICE_USER },
        data: {
          type: 1,
          name: "nav",
          options: [{ type: 1, name: "assign", options: [{ type: 6, name: "user", value: BOB }] }],
        },
      });
      assert.equal(await answer(stub, bob), `Assigned bob@example.com to #${id}.`);
      await eventually(
        () => said(stub, thread).includes(`👤 Assigned to <@${BOB}>.`),
        () => harness.stderr(),
      );
      assert.equal(
        await answer(stub, press(stub, ALICE_USER, `nav:assign-me:${id}`, thread)),
        `alice@example.com is already assigned to #${id}.`,
      );

      assert.equal(
        await answer(stub, slash(stub, BOB_USER, "close", { resolution: "wontfix" }, thread)),
        `Closed #${id} as wontfix.`,
      );
      await eventually(
        () => stub.channels.get(thread)?.thread_metadata?.archived === true,
        () => harness.stderr(),
      );
      assert.equal(
        await answer(stub, press(stub, BOB_USER, `nav:reopen:${id}`, thread)),
        `Reopened #${id}.`,
      );
      await eventually(
        () => said(stub, thread).at(-1) === "🔓 Reopened.",
        () => harness.stderr(),
      );

      // The close button asks why first.
      const [form] = await stub.answers(press(stub, BOB_USER, `nav:close:${id}`, thread).id);
      assert.equal(
        (form?.data as { custom_id: string } | undefined)?.custom_id,
        `nav:m-close:${id}`,
      );
      assert.equal(
        await answer(stub, submit(stub, BOB_USER, `nav:m-close:${id}`, { resolution: "fixed" })),
        `Closed #${id} as fixed.`,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("start a thread on request, show a record, complete ids, and quote a message", async () => {
    const settings = {
      ...SETTINGS,
      issues: [{ channel: TEXT, on: ["assign"] }],
      people: { [ALICE]: "alice@example.com" },
    };
    const bridged = await startBridged({ settings });
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const id = await openIssue(harness, "Quiet one");
      // The record is in the bridge's view once a run has read it.
      let shown = "";
      for (let tries = 0; tries < 50; tries++) {
        const [reply] = await stub.answers(
          slash(stub, ALICE_USER, "show", { id: id.slice(0, 5) }).id,
        );
        shown = JSON.stringify(reply?.data);
        if (shown.includes(`navbook:${id}`)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(shown, new RegExp(`navbook:${id}`));
      assert.match(shown, /"flags":64/);

      assert.match(await answer(stub, slash(stub, BOB_USER, "thread", { id })), /not linked/);
      const started = await answer(stub, slash(stub, ALICE_USER, "thread", { id }));
      const thread = threadOf(stub, TEXT, id);
      assert.equal(started, `Started a thread for #${id}: <#${thread}>`);
      assert.equal(
        await answer(stub, slash(stub, ALICE_USER, "thread", { id })),
        `There already is a thread for #${id}: <#${thread}>`,
      );
      assert.match(await answer(stub, slash(stub, ALICE_USER, "show", { id: "zz" })), /too short/);
      assert.match(
        await answer(stub, slash(stub, ALICE_USER, "show", {})),
        /not a thread about an issue/,
      );

      const completing = stub.interact({
        type: 4,
        member: { user: ALICE_USER },
        data: {
          type: 1,
          name: "nav",
          options: [
            {
              type: 1,
              name: "show",
              options: [{ type: 3, name: "id", value: "quiet", focused: true }],
            },
          ],
        },
      });
      const [choices] = await stub.answers(completing.id);
      assert.equal(choices?.type, 8);
      assert.deepEqual((choices?.data as { choices: unknown[] } | undefined)?.choices, [
        { name: `#${id} Quiet one`, value: id },
      ]);

      const quoted = stub.interact({
        type: 2,
        channel_id: thread,
        member: { user: ALICE_USER },
        data: {
          type: 3,
          name: "Comment on this issue/PR",
          target_id: "300000000000000001",
          resolved: {
            messages: {
              "300000000000000001": {
                id: "300000000000000001",
                channel_id: thread,
                content: "It broke\nagain",
                author: BOB_USER,
              },
            },
          },
        },
      });
      const [form] = await stub.answers(quoted.id);
      assert.equal(form?.type, 9);
      const field = (form?.data as { components: { component: { value: string } }[] } | undefined)
        ?.components[0];
      assert.equal(field?.component.value, "> It broke\n> again\n\n— Bob, on Discord");

      // Nothing is answered for a guild the bridge does not serve.
      const elsewhere = stub.interact({
        type: 2,
        guild_id: "999999999999999999",
        member: { user: ALICE_USER },
        data: { type: 1, name: "nav", options: [{ type: 1, name: "whoami" }] },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        stub.responses.some((response) => response.interaction === elsewhere.id),
        false,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("registers its commands in the guild", async () => {
    const bridged = await startBridged();
    try {
      await bridged.connected();
      const names = (bridged.stub.commands as { name: string; options?: { name: string }[] }[]).map(
        (command) => command.name,
      );
      assert.deepEqual(names, ["nav", "Comment on this issue/PR"]);
      const subs = (bridged.stub.commands as { options?: { name: string }[] }[])[0]?.options?.map(
        (option) => option.name,
      );
      assert.deepEqual(subs, [
        "link",
        "unlink",
        "whoami",
        "comment",
        "review",
        "assign",
        "close",
        "reopen",
        "show",
        "thread",
      ]);
    } finally {
      await bridged.stop();
    }
  });
});

describe("starting", () => {
  it("offers no bridge without a token, and says so", async () => {
    const harness = await startHarness({
      marker: markerWith(SETTINGS),
      env: { NAVBOOK_PLUGIN_PATH: PLUGIN },
    });
    try {
      assert.match(harness.stderr(), /bridge not offered: NAV_SERVER_DISCORD_TOKEN is not set/);
      const read = ok(
        await harness.gql<{ discord: unknown; viewer: { discord: unknown } }>(
          "{ discord { guild } viewer { discord { userId } } }",
        ),
      );
      assert.deepEqual(read, { discord: null, viewer: { discord: [] } });
      await openIssue(harness, "Anything");
      const ext = ok(
        await harness.gql<{ issues: { ext: { discord: unknown } }[] }>("{ issues { ext } }"),
      );
      assert.deepEqual(ext.issues[0]?.ext.discord, { thread: null });
      const link = await harness.gql(
        'mutation { linkDiscord(code: "ABCDEFGH") { link { userId } } }',
      );
      assert.equal(link.errors[0]?.extensions?.code, "PRECONDITION");
    } finally {
      await harness.stop();
    }
  });

  it("refuses to start with a token and settings that do not read, or another guild than the pinned one", async () => {
    await assert.rejects(
      startHarness({
        marker: markerWith({ guild: "general" }),
        env: { NAVBOOK_PLUGIN_PATH: PLUGIN, NAV_SERVER_DISCORD_TOKEN: "t0ken" },
      }),
      /settings in navbook\.json do not read: guild: "general" is not a Discord id/,
    );
    await assert.rejects(
      startHarness({
        marker: markerWith(SETTINGS),
        env: {
          NAVBOOK_PLUGIN_PATH: PLUGIN,
          NAV_SERVER_DISCORD_TOKEN: "t0ken",
          NAV_SERVER_DISCORD_GUILD: "100000000000000099",
        },
      }),
      /navbook\.json names guild 100000000000000001, and NAV_SERVER_DISCORD_GUILD allows only 100000000000000099/,
    );
  });

  it("puts each record's thread on the API, for the web tracker", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Linked from the web");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      const url = `https://discord.com/channels/${GUILD}/${thread}`;
      const read = ok(
        await harness.gql<{
          issue: { ext: { discord: { thread: string } } };
          discord: { guild: string; thread: { id: string; url: string } };
        }>(
          `query Q($ref: ID!) { issue(ref: $ref) { ext } discord { guild thread(ref: $ref) { id url } } }`,
          { ref: id },
        ),
      );
      assert.equal(read.issue.ext.discord.thread, url);
      assert.deepEqual(read.discord, { guild: GUILD, thread: { id: thread, url } });
    } finally {
      await bridged.stop();
    }
  });
});

describe("what Discord does on its own", () => {
  it("reopens a forum post it archived after a quiet week, to redraw its card", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Fix the login", "Retries once.", "pr111111", "fix-login");
      assert.equal(peer.git(["push", "--quiet", "origin", "fix-login"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, FORUM, "pr111111");
      // Archived by Discord, with nobody telling the bridge.
      const metadata = stub.channels.get(thread)?.thread_metadata;
      assert.ok(metadata);
      metadata.archived = true;
      peerComment(harness, "pr", "pr111111", "A week later.", { branch: "fix-login" });
      await eventually(
        () => said(stub, thread).some((line) => line.includes("A week later")),
        () => harness.stderr(),
      );
      const comments = stub
        .card(thread)
        ?.embeds[0]?.fields?.find((field) => field.name === "Comments");
      assert.equal(comments?.value, "1");
    } finally {
      await bridged.stop();
    }
  });

  it("re-sends a new thread's pings when they were cut off", async () => {
    const settings = {
      ...SETTINGS,
      issues: [{ channel: FORUM, on: ["open"] }],
      people: { [ALICE]: "alice@example.com" },
    };
    const bridged = await startBridged({ settings });
    const { stub, harness } = bridged;
    try {
      stub.fail("POST", /^\/channels\/\d+\/messages$/, 502);
      const id = await openIssue(harness, "Pinged late", { assignees: ["alice@example.com"] });
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, FORUM, id);
      await eventually(
        () => said(stub, thread).length === 1,
        () => harness.stderr(),
      );
      assert.equal(said(stub, thread)[0], `👤 Assigned to <@${ALICE}>.`);
      assert.equal(stub.threadsOf(FORUM).length, 1, "made the thread again");
    } finally {
      await bridged.stop();
    }
  });

  it("says when a channel in the settings cannot be used, and makes nothing of it", async () => {
    const settings = { ...SETTINGS, prs: { channel: "100000000000000077" } };
    const bridged = await startBridged({ settings });
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      await eventually(
        () =>
          /channel 100000000000000077 cannot be used: Discord answered 404/.test(harness.stderr()),
        () => harness.stderr(),
      );
      const { peer } = harness.fixture;
      peer.filePr("Nowhere to go", "Body.", "pr333333", "nowhere");
      assert.equal(peer.git(["push", "--quiet", "origin", "nowhere"]).code, 0);
      await eventually(
        () => /Discord refused what #pr333333 needed, and it is passed over/.test(harness.stderr()),
        () => harness.stderr(),
      );
      assert.doesNotMatch(harness.stderr(), /is gone from Discord/);
      assert.equal(stub.threadsOf(FORUM).length, 0);
    } finally {
      await bridged.stop();
    }
  });
});

describe("acting for somebody the server would not let in", () => {
  it("tells them they are not allowed, and the log why", async () => {
    const settings = { ...SETTINGS, people: { [BOB]: "bob@elsewhere.invalid" } };
    const bridged = await startBridged({
      settings,
      harness: { policy: { allowEmailDomains: ["example.invalid"] } },
    });
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const id = await openIssue(harness, "Guarded");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      const said = await answer(
        stub,
        slash(stub, BOB_USER, "comment", { body: "Let me in." }, thread),
      );
      assert.equal(
        said,
        "bob@elsewhere.invalid is not allowed on this repository, so nothing was done.",
      );
      assert.match(
        harness.stderr(),
        /refused a plugin acting as "bob@elsewhere\.invalid": .*not one of example\.invalid/,
      );
      assert.match(
        harness.stderr(),
        new RegExp(
          `refused to act for "bob@elsewhere\\.invalid", linked to Discord user ${BOB_USER.id}\n`,
        ),
      );
      assert.deepEqual(await commentsOf(harness, "issue", id), []);
    } finally {
      await bridged.stop();
    }
  });
});

describe("what the review found", () => {
  it("asks for a name Discord refused only once, until the title changes again", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Plain name");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      const renames = () =>
        stub.requests.filter(
          (request) =>
            request.method === "PATCH" &&
            request.path === `/channels/${thread}` &&
            (request.body as { name?: string }).name !== undefined,
        ).length;
      stub.fail("PATCH", new RegExp(`^/channels/${thread}$`), 400, {
        body: { message: "Invalid Form Body", code: 50035 },
        times: 10,
      });
      await updateIssue(harness, id, { title: "A name the guild's AutoMod refuses" });
      await eventually(
        () => /Discord refused what #\w{8} needed, and it is passed over/.test(harness.stderr()),
        () => harness.stderr(),
      );
      assert.equal(renames(), 1);
      // The next change is told, and the refused name is not asked for again with it.
      await comment(harness, "ISSUE", id, "Still here.");
      await eventually(
        () => said(stub, thread).some((line) => /Still here/.test(line)),
        () => harness.stderr(),
      );
      assert.equal(renames(), 1);
      stub.clearFaults();
    } finally {
      await bridged.stop();
    }
  });

  it("keeps telling a thread whose card somebody deleted", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Card gone");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      stub.messages.set(
        TEXT,
        (stub.messages.get(TEXT) ?? []).filter((message) => message.id !== thread),
      );
      await updateIssue(harness, id, { body: "Redrawn, if there were a card." });
      await comment(harness, "ISSUE", id, "Heard anyway.");
      await eventually(
        () => said(stub, thread).some((line) => /Heard anyway/.test(line)),
        () => harness.stderr(),
      );
      assert.doesNotMatch(harness.stderr(), /is gone from Discord/);
      await comment(harness, "ISSUE", id, "And again.");
      await eventually(
        () => said(stub, thread).some((line) => /And again/.test(line)),
        () => harness.stderr(),
      );
    } finally {
      await bridged.stop();
    }
  });

  it("makes no second forum post when Discord's answer to the first was lost", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      stub.fail("POST", new RegExp(`^/channels/${FORUM}/threads$`), 502, { apply: true });
      const { peer } = harness.fixture;
      peer.filePr("Made once", "Lost answer.", "pr555555", "made-once");
      assert.equal(peer.git(["push", "--quiet", "origin", "made-once"]).code, 0);
      await eventually(
        () => /could not tell the thread of #pr555555/.test(harness.stderr()),
        () => harness.stderr(),
      );
      // Tried again on the backoff: the post Discord made is found and taken, not made again.
      const thread = threadOf(stub, FORUM, "pr555555");
      await taken(harness, "pr555555", thread);
      assert.equal(stub.threadsOf(FORUM).length, 1);
      assert.equal(
        stub.requests.filter(
          (request) => request.method === "POST" && request.path === `/channels/${FORUM}/threads`,
        ).length,
        1,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("hangs no second thread in a text channel when Discord's answer to the first was lost", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      stub.fail("POST", new RegExp(`^/channels/${TEXT}/messages/\\d+/threads$`), 502, {
        apply: true,
      });
      const id = await openIssue(harness, "Hung once");
      await eventually(
        () => /could not tell the thread of/.test(harness.stderr()),
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      await taken(harness, id, thread);
      await comment(harness, "ISSUE", id, "Into the one thread.");
      await eventually(
        () => said(stub, thread).some((line) => /Into the one thread/.test(line)),
        () => harness.stderr(),
        20_000,
      );
      assert.equal(stub.threadsOf(TEXT).length, 1);
      // The card stayed with the thread Discord made.
      assert.equal((stub.messages.get(TEXT) ?? []).length, 1);
      assert.equal(stub.card(thread)?.embeds[0]?.footer?.text, `navbook:${id}`);
    } finally {
      await bridged.stop();
    }
  });

  it("passes over a channel no thread can be made in, rather than trying it again", async () => {
    const bridged = await startBridged({
      settings: { ...SETTINGS, issues: [{ channel: VOICE, on: ["open"] }] },
    });
    const { harness } = bridged;
    try {
      const id = await openIssue(harness, "Nowhere to go");
      await eventually(
        () =>
          new RegExp(
            `Discord refused what #${id} needed, and it is passed over: channel ${VOICE} is neither a forum nor a text channel`,
          ).test(harness.stderr()),
        () => harness.stderr(),
      );
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      assert.doesNotMatch(harness.stderr(), /could not tell the thread of/);
      assert.equal(
        harness
          .stderr()
          .split("\n")
          .filter((line) => line.includes("passed over")).length,
        1,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("archives a thread a rule opens for a record already closed", async () => {
    const bridged = await startBridged({
      settings: { ...SETTINGS, issues: [{ channel: TEXT, on: ["status:closed"] }] },
    });
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Done already");
      await closeIssue(harness, id, "fixed");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      await eventually(
        () => stub.channels.get(thread)?.thread_metadata?.archived === true,
        () => harness.stderr(),
      );
    } finally {
      await bridged.stop();
    }
  });

  it("posts nothing in a channel of another guild, whatever the settings say", async () => {
    const bridged = await startBridged({ settings: { ...SETTINGS, prs: { channel: ELSEWHERE } } });
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Leaky", "Secret plans.", "pr444444", "leaky");
      assert.equal(peer.git(["push", "--quiet", "origin", "leaky"]).code, 0);
      await eventually(
        () =>
          /channel 100000000000000005 is not in guild 100000000000000001/.test(harness.stderr()),
        () => harness.stderr(),
      );
      assert.equal(stub.threadsOf(ELSEWHERE).length, 0);
      assert.equal(
        stub.requests.some(
          (request) => request.method === "POST" && request.path.includes(ELSEWHERE),
        ),
        false,
      );
    } finally {
      await bridged.stop();
    }
  });

  it("leaves no card behind when a text channel's thread cannot be made from it", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      stub.fail("POST", new RegExp(`^/channels/${TEXT}/messages/\\d+/threads$`), 502);
      const id = await openIssue(harness, "Second time lucky");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
        20_000,
      );
      // The first card went with its failed thread; the second has one.
      assert.equal((stub.messages.get(TEXT) ?? []).length, 1);
      assert.equal(stub.card(threadOf(stub, TEXT, id))?.embeds[0]?.footer?.text, `navbook:${id}`);
    } finally {
      await bridged.stop();
    }
  });

  it("tells each change once, when a run fails part of the way through", async () => {
    const people = { [ALICE]: "alice@example.com" };
    const bridged = await startBridged({ settings: { ...SETTINGS, people } });
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Half told");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      // The retitle is told; the assignment after it is refused, then tried again.
      stub.fail("POST", new RegExp(`^/channels/${thread}/messages$`), 502, { skip: 1 });
      peerEdit(harness, recordPath(harness, id), (text) =>
        text
          .replace("title: Half told", "title: Fully told")
          .replace("---\n\n", "assignee: alice@example.com\n---\n\n"),
      );
      await eventually(
        () => said(stub, thread).length === 2,
        () => harness.stderr(),
        20_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(said(stub, thread), [
        "✏️ Retitled: “Half told” → “Fully told”.",
        `👤 Assigned to <@${ALICE}>.`,
      ]);
    } finally {
      await bridged.stop();
    }
  });

  it("does not post twice a message whose answer was lost after Discord made it", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const id = await openIssue(harness, "Lost answer");
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const thread = threadOf(stub, TEXT, id);
      stub.fail("POST", new RegExp(`^/channels/${thread}/messages$`), 502, { apply: true });
      await comment(harness, "ISSUE", id, "Made, then lost.");
      await eventually(
        () => /could not tell the thread of/.test(harness.stderr()),
        () => harness.stderr(),
      );
      // Tried again on the backoff: Discord answers with the message it made.
      await eventually(
        () =>
          stub.requests.filter(
            (request) =>
              request.method === "POST" && request.path === `/channels/${thread}/messages`,
          ).length === 2,
        () => harness.stderr(),
        20_000,
      );
      assert.equal(said(stub, thread).length, 1);
    } finally {
      await bridged.stop();
    }
  });

  it("names the account a code was asked for, and does not link one code twice", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      await bridged.connected();
      const offered = await answer(stub, slash(stub, ALICE_USER, "link"));
      const code = /code=([A-Z0-9]{8})/.exec(offered)?.[1] as string;
      const asked = ok(
        await harness.gql<{ discord: { pending: unknown } }>(
          "query P($code: String!) { discord { pending(code: $code) { userId username handle } } }",
          { code },
        ),
      );
      assert.deepEqual(asked.discord.pending, {
        userId: ALICE,
        username: "Alice",
        handle: "alice",
      });

      // Two redemptions at once: one links, the other is told the code is spent.
      const alice = await harness.token({ name: "Alice Smith", email: "alice@example.com" });
      const mallory = await harness.token({ name: "Mallory", email: "mallory@example.com" });
      const link = "mutation L($code: String!) { linkDiscord(code: $code) { link { userId } } }";
      const [one, two] = await Promise.all([
        harness.gql(link, { code }, alice),
        harness.gql(link, { code }, mallory),
      ]);
      const errors = [one, two].map((each) => each.errors[0]?.extensions?.code ?? null).sort();
      assert.deepEqual(errors, ["INVALID_INPUT", null]);
      assert.equal(
        originSubjects(harness.fixture.origin).filter((subject) =>
          subject.startsWith("docs(discord): link"),
        ).length,
        1,
      );
      const spent = ok(
        await harness.gql<{ discord: { pending: unknown } }>(
          "query P($code: String!) { discord { pending(code: $code) { userId } } }",
          { code },
        ),
      );
      assert.equal(spent.discord.pending, null);
    } finally {
      await bridged.stop();
    }
  });

  it("lists every account linked to a person", async () => {
    const settings = {
      ...SETTINGS,
      people: { [ALICE]: "alice@example.com", [BOB]: "Alice@Example.com" },
    };
    const bridged = await startBridged({ settings });
    const { harness } = bridged;
    try {
      const alice = await harness.token({ name: "Alice Smith", email: "alice@example.com" });
      const read = ok(
        await harness.gql<{ viewer: { discord: { userId: string }[] } }>(
          "{ viewer { discord { userId } } }",
          undefined,
          alice,
        ),
      );
      assert.deepEqual(read.viewer.discord.map((link) => link.userId).sort(), [ALICE, BOB]);
    } finally {
      await bridged.stop();
    }
  });
});
