/**
 * The bridge's pure parts: its settings, what it makes of two states of a
 * record, which rule opens a thread, and what a thread shows.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import { editPeople, MarkerError } from "../src/core/marker.ts";
import { parseSettings, parseTrigger, peopleOf, type Settings } from "../src/core/settings.ts";
import { fieldValues } from "../src/server/commands.ts";
import { LinkCodes } from "../src/server/link.ts";
import { diffSeen, firstSighting, seenOf } from "../src/server/model.ts";
import {
  actionId,
  card,
  cut,
  EMBED_LIMIT,
  embedSize,
  excerpt,
  idOfThreadName,
  messages,
  parseActionId,
  type RenderContext,
  tagIds,
  tagNames,
  threadName,
} from "../src/server/render.ts";
import { compileRules, fires, openingFor, watchedFields } from "../src/server/rules.ts";
import { comment, HEAD, HEAD_2, issue, pr } from "./helpers/records.ts";

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000003";
const ALICE = "111111111111111111";

function settings(raw: Record<string, unknown>): Settings {
  const reading = parseSettings({ guild: GUILD, ...raw }, core);
  assert.ok(reading.ok, reading.ok ? "" : reading.problems.join("; "));
  return reading.settings;
}

describe("the settings", () => {
  it("read with their defaults filled in", () => {
    const read = settings({
      url: "https://tracker.example/",
      prs: { channel: CHANNEL },
      issues: [
        { channel: CHANNEL },
        {
          channel: CHANNEL,
          scope: "root",
          on: ["assign", "field:priority=high"],
          match: " label:bug  feature:auth ",
        },
      ],
      people: { [ALICE]: "alice@example.com" },
    });
    assert.equal(read.url, "https://tracker.example");
    assert.deepEqual(read.prs, { channel: CHANNEL });
    assert.deepEqual(read.issues[0], {
      channel: CHANNEL,
      scope: "all",
      on: [{ kind: "open" }],
      match: [],
    });
    assert.deepEqual(read.issues[1]?.on, [
      { kind: "assign" },
      { kind: "field", key: "priority", value: "high" },
    ]);
    assert.deepEqual(read.issues[1]?.match, ["label:bug", "feature:auth"]);
    assert.deepEqual([...read.people], [[ALICE, "alice@example.com"]]);
  });

  it("name every fault by its key, all at once", () => {
    const reading = parseSettings(
      {
        guild: 123,
        url: "ftp://nope",
        prs: { channel: "general", topic: "x" },
        issues: [
          { on: [] },
          { channel: CHANNEL, scope: "some", on: ["closed", "status:merged", 7], match: 5 },
        ],
        people: { alice: "alice@example.com", [ALICE]: "Alice <alice@example.com>" },
        isssues: [],
      },
      core,
    );
    assert.equal(reading.ok, false);
    const problems = reading.ok ? [] : reading.problems;
    for (const expected of [
      /^isssues: not a setting/,
      /^guild: 123 is not a Discord id/,
      /^url: "ftp:\/\/nope" is not an http\(s\) address/,
      /^prs\.topic: not a setting/,
      /^prs\.channel: "general" is not a Discord id/,
      /^issues\[0\]\.channel: missing/,
      /^issues\[0\]\.on: not a non-empty list/,
      /^issues\[1\]\.scope: "some" is neither/,
      /^issues\[1\]\.on\[0\]: "closed" is not a trigger; use "status:closed"/,
      /^issues\[1\]\.on\[1\]: "status:merged" is not a status an issue has/,
      /^issues\[1\]\.on\[2\]: 7 is not a trigger/,
      /^issues\[1\]\.match: not query terms/,
      /^people\.alice: "alice" is not a Discord user id/,
      new RegExp(`^people\\.${ALICE}: "Alice <alice@example\\.com>" is not an email address`),
    ]) {
      assert.ok(
        problems.some((problem) => expected.test(problem)),
        `${expected} not in:\n${problems.join("\n")}`,
      );
    }
  });

  it("want a guild, and nothing that is not an object", () => {
    assert.deepEqual(parseSettings({}, core), {
      ok: false,
      problems: ["guild: missing; a Discord id is needed here"],
    });
    assert.deepEqual(parseSettings([], core), {
      ok: false,
      problems: ["the settings are not a JSON object"],
    });
  });

  it("read triggers as rules write them", () => {
    assert.deepEqual(parseTrigger(" field:due-date "), { kind: "field", key: "due-date" });
    assert.deepEqual(parseTrigger("field:priority= high"), {
      kind: "field",
      key: "priority",
      value: "high",
    });
    for (const bad of [
      "field:",
      "field:Priority",
      "field:priority=",
      "assigned",
      "status:merged",
      "label:bug",
    ]) {
      assert.equal(parseTrigger(bad), null, bad);
    }
  });

  it("keep the people that read when others do not", () => {
    const { people, problems } = peopleOf(
      { people: { [ALICE]: "alice@example.com", "222": "bob@example.com" } },
      core,
    );
    assert.deepEqual([...people], [[ALICE, "alice@example.com"]]);
    assert.equal(problems.length, 1);
    assert.deepEqual(peopleOf(undefined, core), { people: new Map(), problems: [] });
  });
});

describe("editing the people map", () => {
  const marker = `${JSON.stringify(
    {
      version: 1,
      review: { minApprovals: 2 },
      plugins: { "@navbook/plugin-kb": {}, "@navbook/plugin-discord": { guild: GUILD } },
    },
    null,
    2,
  )}\n`;

  it("adds to the map and keeps everything else in its place", () => {
    const edited = editPeople(marker, (people) => {
      people[ALICE] = "alice@example.com";
    });
    assert.equal(edited.changed, true);
    const parsed = JSON.parse(edited.text);
    assert.deepEqual(Object.keys(parsed), ["version", "review", "plugins"]);
    assert.deepEqual(Object.keys(parsed.plugins), [
      "@navbook/plugin-kb",
      "@navbook/plugin-discord",
    ]);
    assert.deepEqual(parsed.plugins["@navbook/plugin-discord"], {
      guild: GUILD,
      people: { [ALICE]: "alice@example.com" },
    });
    assert.ok(edited.text.endsWith("}\n"));
  });

  it("returns the text untouched when nothing changed, however it was written", () => {
    const tight = JSON.stringify({
      version: 1,
      plugins: { "@navbook/plugin-discord": { guild: GUILD } },
    });
    const edited = editPeople(tight, () => undefined);
    assert.deepEqual(edited, { text: tight, changed: false });
  });

  it("removes an emptied map", () => {
    const linked = editPeople(marker, (people) => {
      people[ALICE] = "alice@example.com";
    }).text;
    const emptied = editPeople(linked, (people) => {
      delete people[ALICE];
    });
    assert.equal(emptied.changed, true);
    assert.deepEqual(JSON.parse(emptied.text).plugins["@navbook/plugin-discord"], { guild: GUILD });
  });

  it("refuses a marker it cannot read or that does not declare the plugin", () => {
    assert.throws(() => editPeople(undefined, () => undefined), MarkerError);
    assert.throws(() => editPeople("{", () => undefined), /not valid JSON/);
    assert.throws(() => editPeople("[]", () => undefined), /not a JSON object/);
    assert.throws(
      () => editPeople('{"version":1}', () => undefined),
      /does not declare @navbook\/plugin-discord/,
    );
  });
});

describe("what changed between two sightings", () => {
  it("is nothing for the same record, and that it opened or went for none", () => {
    const seen = seenOf(issue());
    assert.deepEqual(diffSeen(core, seen, seenOf(issue())), []);
    assert.deepEqual(diffSeen(core, undefined, seen), [{ type: "opened" }]);
    assert.deepEqual(diffSeen(core, seen, undefined), [{ type: "gone" }]);
    assert.deepEqual(diffSeen(core, undefined, undefined), []);
  });

  it("names a status change with why, a retitle, and who was assigned or let go", () => {
    const before = seenOf(issue({ fm: "assignee: [alice@example.com, Bob <bob@example.com>]\n" }));
    const after = seenOf(
      issue({
        status: "closed",
        title: "Login times out on 3G",
        fm: "assignee: [BOB@example.com, carol@example.com]\nresolution: fixed\n",
      }),
    );
    const events = diffSeen(core, before, after);
    assert.deepEqual(events.slice(0, 3), [
      { type: "status", from: "open", to: "closed", resolution: "fixed" },
      { type: "retitled", from: "Login times out", to: "Login times out on 3G" },
      { type: "assigned", added: ["carol@example.com"], removed: ["alice@example.com"] },
    ]);
    // The resolution is a field too, for a rule that watches it.
    assert.deepEqual(events.slice(3), [
      { type: "field", key: "resolution", before: undefined, after: "fixed" },
    ]);
  });

  it("names new comments, reviewers and revisions of a pull request", () => {
    const before = seenOf(
      pr({ comments: { "2026-08-05T101433Z-cmt11111.md": comment("alice@example.com", "Hm.") } }),
    );
    const after = seenOf(
      pr({
        fm: `reviewer: carol@example.com\nrevisions:\n  - head: ${HEAD}\n    base: ${HEAD}\n    date: 2026-08-04T16:40:00Z\n  - head: ${HEAD_2}\n    base: ${HEAD}\n    date: 2026-08-06T16:40:00Z\n`,
        comments: {
          "2026-08-05T101433Z-cmt11111.md": comment("alice@example.com", "Hm."),
          "2026-08-07T101433Z-cmt22222.md": comment(
            "carol@example.com",
            "Fine.",
            `verdict: approve\nrevision: ${HEAD_2}\n`,
          ),
        },
      }),
    );
    assert.deepEqual(diffSeen(core, before, after), [
      { type: "reviewers", added: ["carol@example.com"], removed: [] },
      { type: "revised", heads: [HEAD_2] },
      { type: "comment", id: "cmt22222" },
    ]);
  });

  it("compares as it would after a restart, dates and all", () => {
    const record = issue({ fm: "deadline: 2026-09-01\nnext-review: 2026-08-10T10:00:00Z\n" });
    const restored = JSON.parse(JSON.stringify(seenOf(record)));
    assert.deepEqual(diffSeen(core, restored, seenOf(record)), []);
  });

  it("on first sight, offers the rules everything the record already carries", () => {
    const events = firstSighting(
      core,
      seenOf(issue({ fm: "assignee: alice@example.com\npriority: high\n" })),
    );
    assert.deepEqual(events, [
      { type: "opened" },
      { type: "assigned", added: ["alice@example.com"], removed: [] },
      { type: "field", key: "priority", before: undefined, after: "high" },
    ]);
  });
});

describe("which rule opens a thread", () => {
  const policy = core.DEFAULT_REVIEW_POLICY;
  const ext = core.NO_EXTENSIONS;

  it("fires each trigger on what it names, and field values only on the way in", () => {
    assert.ok(fires({ kind: "open" }, [{ type: "opened" }]));
    assert.ok(!fires({ kind: "assign" }, [{ type: "assigned", added: [], removed: ["a@x.io"] }]));
    assert.ok(
      fires({ kind: "status", status: "closed" }, [
        { type: "status", from: "open", to: "closed", resolution: null },
      ]),
    );
    assert.ok(!fires({ kind: "status", status: "open" }, [{ type: "opened" }]));
    const field = (before: unknown, after: unknown) => [
      { type: "field" as const, key: "priority", before, after },
    ];
    assert.ok(fires({ kind: "field", key: "priority" }, field(undefined, "low")));
    assert.ok(fires({ kind: "field", key: "priority" }, field("low", "high")));
    assert.ok(
      !fires({ kind: "field", key: "priority" }, field("low", undefined)),
      "removed is not added",
    );
    assert.ok(fires({ kind: "field", key: "priority", value: "high" }, field("low", "high")));
    assert.ok(!fires({ kind: "field", key: "priority", value: "high" }, field("high", "high ")));
    assert.ok(
      fires({ kind: "field", key: "labels", value: "bug" }, [
        { type: "field", key: "labels", before: ["ui"], after: ["ui", "bug"] },
      ]),
    );
    assert.ok(
      !fires({ kind: "field", key: "labels", value: "bug" }, [
        { type: "field", key: "labels", before: ["bug"], after: ["bug", "ui"] },
      ]),
    );
  });

  it("weighs scope, query and order, and gives pull requests their channel on opening", () => {
    const read = settings({
      prs: { channel: "100000000000000002" },
      issues: [
        { channel: "100000000000000004", scope: "root", on: ["assign"] },
        { channel: "100000000000000005", on: ["assign"], match: "label:bug" },
      ],
    });
    const { rules, problems } = compileRules(core, read, ext);
    assert.deepEqual(problems, []);
    const assigned = [{ type: "assigned" as const, added: ["a@x.io"], removed: [] }];
    const root = issue({ fm: "labels: [bug]\n" });
    const child = issue({ fm: "labels: [bug]\nparent: par11111\n" });
    const plain = issue({ fm: "parent: par11111\n" });
    assert.equal(
      openingFor(core, root, assigned, read, rules, policy, ext)?.channel,
      "100000000000000004",
    );
    assert.equal(
      openingFor(core, child, assigned, read, rules, policy, ext)?.channel,
      "100000000000000005",
    );
    assert.equal(openingFor(core, plain, assigned, read, rules, policy, ext), null);
    assert.equal(openingFor(core, root, [{ type: "opened" }], read, rules, policy, ext), null);
    assert.deepEqual(openingFor(core, pr(), [{ type: "opened" }], read, rules, policy, ext), {
      channel: "100000000000000002",
      trigger: null,
    });
    assert.equal(openingFor(core, pr(), assigned, read, rules, policy, ext), null);
    assert.deepEqual(
      [
        ...watchedFields(
          settings({ issues: [{ channel: CHANNEL, on: ["field:priority=high", "open"] }] }),
        ),
      ],
      ["priority"],
    );
  });

  it("names a rule whose query does not parse", () => {
    const { problems } = compileRules(
      core,
      settings({ issues: [{ channel: CHANNEL, match: "deadline:soon" }] }),
      ext,
    );
    assert.match(problems[0] ?? "", /^issues\[0\]\.match: /);
  });
});

describe("what a thread shows", () => {
  const ctx = (people: Record<string, string> = {}): RenderContext => {
    const byAddress = new Map(Object.entries(people).map(([user, email]) => [email, user]));
    return {
      core,
      url: "https://tracker.example",
      discordOf: (address) => byAddress.get(address) ?? null,
      policy: core.DEFAULT_REVIEW_POLICY,
    };
  };

  it("names the thread by the id first, within Discord's hundred characters", () => {
    assert.equal(
      threadName({ id: "iss11111", title: "Login\ntimes   out" }),
      "#iss11111 Login times out",
    );
    const long = threadName({ id: "iss11111", title: "é".repeat(200) });
    assert.equal(Array.from(long).length, 100);
    assert.ok(long.endsWith("…"));
    assert.equal(idOfThreadName("#iss11111 Login"), "iss11111");
    assert.equal(idOfThreadName("#iss11111"), "iss11111");
    for (const other of ["iss11111 Login", "#iss1111 short", "#iss11111x", undefined]) {
      assert.equal(idOfThreadName(other), null, String(other));
    }
  });

  it("draws an issue's card, with its buttons and the people linked", () => {
    const body = card(
      ctx({ [ALICE]: "alice@example.com" }),
      issue({ fm: "assignee: alice@example.com\nlabels: [bug, ui]\nparent: par11111\n" }),
    );
    const embed = body.embeds?.[0];
    assert.equal(embed?.title, "#iss11111 Login times out");
    assert.equal(embed?.url, "https://tracker.example/issues/iss11111");
    assert.equal(embed?.footer?.text, "navbook:iss11111");
    const fields = Object.fromEntries(
      (embed?.fields ?? []).map((field) => [field.name, field.value]),
    );
    assert.deepEqual(fields, {
      Status: "Open",
      Author: "<@111111111111111111>",
      Assignees: "<@111111111111111111>",
      Labels: "bug, ui",
      Parent: "#par11111",
      Comments: "0",
    });
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.deepEqual(
      body.components?.[0]?.components.map((button) => button.custom_id),
      ["nav:comment:iss11111", "nav:assign-me:iss11111", "nav:close:iss11111"],
    );
    const closed = card(ctx(), issue({ status: "closed", fm: "resolution: wontfix\n" }));
    assert.equal(closed.embeds?.[0]?.fields?.[0]?.value, "Closed · wontfix");
    assert.deepEqual(
      closed.components?.[0]?.components.map((button) => button.label),
      ["Comment", "Reopen"],
    );
  });

  it("draws a pull request's card with its reviews, and buttons bound to the revision shown", () => {
    const body = card(
      ctx(),
      pr({
        fm: `reviewer: carol@example.com\nrevisions:\n  - head: ${HEAD}\n    base: ${HEAD_2}\n    date: 2026-08-04T16:40:00Z\n`,
      }),
    );
    const fields = Object.fromEntries(
      (body.embeds?.[0]?.fields ?? []).map((field) => [field.name, field.value]),
    );
    assert.equal(fields.Reviews, "⏳ carol@example.com");
    assert.equal(fields.Decision, "pending (0/1 approvals)");
    assert.equal(fields.Branch, "`fix-login` → `main`");
    const ids = body.components?.[0]?.components.map((button) => button.custom_id) ?? [];
    assert.deepEqual(ids, [
      `nav:approve:pr111111:${HEAD.slice(0, 12)}`,
      `nav:changes:pr111111:${HEAD.slice(0, 12)}`,
      "nav:comment:pr111111",
    ]);
    assert.deepEqual(parseActionId(ids[0] as string), {
      action: "approve",
      id: "pr111111",
      extra: HEAD.slice(0, 12),
    });
    assert.equal(
      card(
        ctx(),
        pr({
          fm: `draft: true\nrevisions:\n  - head: ${HEAD}\n    base: ${HEAD_2}\n    date: 2026-08-04T16:40:00Z\n`,
        }),
      ).embeds?.[0]?.fields?.[0]?.value,
      "Draft",
    );
  });

  it("keeps a long body inside the card, closing a code fence it cut", () => {
    const body = `\`\`\`\n${"x".repeat(3_000)}\n\`\`\``;
    const shown = card(ctx(), issue({ body })).embeds?.[0]?.description ?? "";
    assert.ok(shown.length < 1_600);
    assert.ok(shown.endsWith("```"));
    assert.equal(excerpt("short", 10), "short");
  });

  it("pings exactly who is asked for something, and nobody for anything else", () => {
    const record = pr({
      comments: {
        "2026-08-07T101433Z-cmt22222.md": comment(
          "Carol <carol@example.com>",
          "Looks @everyone good.\nLine two.",
          `verdict: approve\nrevision: ${HEAD}\n`,
        ),
      },
    });
    const sent = messages(
      ctx({ [ALICE]: "alice@example.com" }),
      record,
      seenOf(record),
      [
        {
          type: "assigned",
          added: ["Alice <alice@example.com>", "dave@example.com"],
          removed: ["erin@example.com"],
        },
        { type: "reviewers", added: ["dave@example.com"], removed: [] },
        { type: "comment", id: "cmt22222" },
        { type: "status", from: "open", to: "merged", resolution: null },
        { type: "field", key: "priority", before: "low", after: "high" },
        { type: "opened" },
      ],
      new Set(),
    );
    assert.deepEqual(sent[0], {
      content:
        "👤 Assigned to <@111111111111111111>, dave@example.com.\nUnassigned: erin@example.com.",
      allowed_mentions: { parse: [], users: [ALICE] },
    });
    assert.deepEqual(sent[1]?.allowed_mentions, { parse: [], users: [] });
    assert.equal(
      sent[2]?.content,
      "✅ **Carol** approved this pull request:\n> Looks @everyone good.\n> Line two.",
    );
    assert.deepEqual(sent[2]?.allowed_mentions, { parse: [] });
    assert.equal(sent[3]?.content, "🟣 Merged.");
    // An unwatched field changes the card only; `opened` is the card itself.
    assert.equal(sent.length, 4);
    const watched = messages(
      ctx(),
      record,
      seenOf(record),
      [{ type: "field", key: "priority", before: "low", after: ["high", "now"] }],
      new Set(["priority"]),
    );
    assert.equal(watched[0]?.content, "🏷️ **priority**: low → high, now.");
  });

  it("keeps a card within Discord's 6000 characters, however much the record carries", () => {
    const many = Array.from({ length: 60 }, (_, index) => `person${index}@example.com`).join(", ");
    const labels = Array.from({ length: 80 }, (_, index) => `label-number-${index}`).join(", ");
    const record = pr({
      source: `feature/${"b".repeat(240)}`,
      title: "x".repeat(300),
      body: "y".repeat(5_000),
      fm:
        `assignee: [${many}]\nreviewer: [${many}]\nlabels: [${labels}]\nmilestone: ${"m".repeat(1_200)}\n` +
        `revisions:\n  - head: ${HEAD}\n    base: ${HEAD_2}\n    date: 2026-08-04T16:40:00Z\n`,
    });
    const embed = card(ctx(), record).embeds?.[0];
    assert.ok(embed);
    assert.ok((embed.fields ?? []).length >= 6);
    assert.ok(embedSize(embed) <= EMBED_LIMIT, `${embedSize(embed)} characters`);
    for (const field of embed.fields ?? []) assert.ok(Array.from(field.value).length <= 1_024);
    // What fits is left alone.
    const small = card(ctx(), issue()).embeds?.[0];
    assert.equal(small?.description, "It aborts after 5 s.");
  });

  it("keeps every message inside 2000 characters", () => {
    const record = issue({
      comments: { "2026-08-07T101433Z-cmt22222.md": comment("a@example.com", "y".repeat(5_000)) },
    });
    const [sent] = messages(
      ctx(),
      record,
      seenOf(record),
      [{ type: "comment", id: "cmt22222" }],
      new Set(),
    );
    assert.ok(Array.from(sent?.content ?? "").length <= 2_000);
    assert.equal(cut("abc", 2), "a…");
  });

  it("applies only the forum's tags, at most five, by name", () => {
    const available = [
      { id: "1", name: "Open" },
      { id: "2", name: "bug" },
      { id: "3", name: "a" },
      { id: "4", name: "b" },
      { id: "5", name: "c" },
      { id: "6", name: "d" },
    ];
    assert.deepEqual(tagNames(core, issue({ fm: "labels: [bug, missing]\n" })), [
      "open",
      "bug",
      "missing",
    ]);
    assert.deepEqual(tagIds(["open", "BUG", "missing"], available), ["1", "2"]);
    assert.deepEqual(tagIds(["open", "bug", "a", "b", "c", "d"], available), [
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    assert.deepEqual(
      tagNames(
        core,
        pr({
          fm: `draft: true\nrevisions:\n  - head: ${HEAD}\n    base: ${HEAD_2}\n    date: 2026-08-04T16:40:00Z\n`,
        }),
      ),
      ["draft"],
    );
  });

  it("names its components so they can be read back", () => {
    assert.equal(actionId("m-comment", "iss11111"), "nav:m-comment:iss11111");
    assert.deepEqual(parseActionId("nav:m-comment:iss11111"), {
      action: "m-comment",
      id: "iss11111",
      extra: undefined,
    });
    assert.equal(parseActionId("other:thing"), null);
    assert.equal(parseActionId("nav:approve:NOTANID"), null);
  });
});

describe("link codes", () => {
  it("work once, for a while, and one at a time per account", () => {
    let now = 0;
    const codes = new LinkCodes({ ttlMs: 1_000, now: () => now });
    const first = codes.mint(ALICE, "Alice", "alice");
    assert.match(first, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.deepEqual(codes.peek(first.toLowerCase()), {
      user: ALICE,
      username: "Alice",
      handle: "alice",
      expires: 1_000,
    });
    assert.equal(codes.peek(`${first.slice(0, 4)}-${first.slice(4)}`)?.user, ALICE);
    const second = codes.mint(ALICE, "Alice", "alice");
    assert.equal(codes.peek(first), null, "a new code replaces the old");
    const taken = codes.take(second);
    assert.equal(taken?.user, ALICE);
    assert.equal(codes.take(second), null, "a code works once, even raced");
    // A link that could not be written gives its code back, while it is live.
    codes.restore(second, taken as NonNullable<typeof taken>);
    assert.equal(codes.peek(second)?.user, ALICE);
    const third = codes.mint(ALICE, "Alice", "alice");
    now = 1_000;
    assert.equal(codes.peek(third), null, "a code expires");
    codes.restore(third, { user: ALICE, username: "Alice", handle: "alice", expires: 1_000 });
    assert.equal(codes.peek(third), null, "an expired code is not given back");
  });
});

describe("a submitted modal", () => {
  it("is read however Discord nested its fields", () => {
    const values = fieldValues([
      { type: 18, component: { type: 4, custom_id: "body", value: "Hello" } },
      { type: 1, components: [{ type: 4, custom_id: "resolution", value: "fixed" }] },
      { type: 10, content: "text" },
    ]);
    assert.deepEqual(
      [...values],
      [
        ["body", "Hello"],
        ["resolution", "fixed"],
      ],
    );
  });
});
