/**
 * `nav chat`, end to end: the real CLI, a real repository, a stub model.
 *
 * What is asserted is what the person would see and what ends up in the tree:
 * the reply on stdout, one line per tool on stderr, and the commits a write
 * made — or did not make, when nobody approved it.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { makeNavRepo, type TempRepo } from "@navbook/cli/test-helpers";
import { nav, PLUGIN } from "./helpers/nav.ts";
import { type StubLlm, startStubLlm } from "./helpers/stub-llm.ts";

let stub: StubLlm;

before(async () => {
  stub = await startStubLlm();
});

after(async () => {
  await stub.close();
});

/** A repository with the plugin configured to talk to the stub. */
function chatRepo(): TempRepo {
  const repo = makeNavRepo();
  return repo;
}

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NAV_CHAT_BASE_URL: stub.url,
  NAV_CHAT_MODEL: "stub-model",
  NAV_CHAT_API_KEY: "test-key",
  ...extra,
});

/** Subjects on a branch, newest first. */
function subjects(repo: TempRepo, ref = "HEAD"): string[] {
  return repo.git(["log", "--format=%s", ref]).stdout.split("\n").filter(Boolean);
}

/** What the model was told a tool answered, in the last request. */
function lastToolAnswer(): unknown {
  const messages = stub.requests.at(-1)?.body.messages ?? [];
  const tool = [...messages].reverse().find((message) => message.role === "tool");
  return tool ? JSON.parse(tool.content ?? "null") : undefined;
}

describe("nav chat", () => {
  it("is listed in the help without loading the plugin", async () => {
    const repo = chatRepo();
    try {
      const help = await nav(repo, ["--help"]);
      assert.equal(help.code, 0);
      assert.match(help.stdout, /chat \[options\]\s+talk to an assistant about this tracker/);
    } finally {
      repo.cleanup();
    }
  });

  it("answers one question, telling the model who is asking and when", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue({ text: "Nothing is open." });
      const answered = await nav(repo, ["chat", "-m", "what is open?"], env());
      assert.equal(answered.code, 0, answered.stderr);
      assert.equal(answered.stdout, "Nothing is open.\n");
      const request = stub.requests.at(-1);
      assert.equal(request?.authorization, "Bearer test-key");
      assert.equal(request?.body.model, "stub-model");
      assert.equal(request?.body.tools?.length, 9);
      const [system, user] = request?.body.messages ?? [];
      assert.equal(system?.role, "system");
      assert.match(system?.content ?? "", /You are the assistant for a Navbook issue tracker/);
      assert.match(system?.content ?? "", /talking to Nav Test <nav@test\.invalid>/);
      assert.match(system?.content ?? "", /Today is 2026-08-01/);
      assert.match(system?.content ?? "", /checked-out branch is `main`/);
      assert.deepEqual(user, { role: "user", content: "what is open?" });
    } finally {
      repo.cleanup();
    }
  });

  it("reads the model and endpoint the repository's navbook.json names", async () => {
    const repo = chatRepo();
    try {
      repo.write(
        ".navbook/navbook.json",
        `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-chat": { model: "team-model", baseUrl: stub.url } } }, null, 2)}\n`,
      );
      stub.enqueue({ text: "Hello." });
      const answered = await nav(repo, ["chat", "-m", "hi"]);
      assert.equal(answered.code, 0, answered.stderr);
      assert.equal(stub.requests.at(-1)?.body.model, "team-model");
      assert.equal(stub.requests.at(-1)?.authorization, undefined);
    } finally {
      repo.cleanup();
    }
  });

  it("says how to configure a model, and asks nobody anything, when none is set", async () => {
    const repo = chatRepo();
    try {
      const before = stub.requests.length;
      const refused = await nav(repo, ["chat", "-m", "hi"], { NAV_CHAT_BASE_URL: stub.url });
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /no model is configured/);
      assert.match(refused.stderr, /--model <id>, set NAV_CHAT_MODEL/);
      assert.equal(stub.requests.length, before);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to ask nothing", async () => {
    const repo = chatRepo();
    try {
      const refused = await nav(repo, ["chat", "-m", "   "], env());
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /nothing to ask/);
    } finally {
      repo.cleanup();
    }
  });

  it("makes what is piped in part of the question", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue({ text: "Summarised." });
      const answered = await nav(repo, ["chat", "-m", "summarise this"], env(), "a long log\n");
      assert.equal(answered.code, 0, answered.stderr);
      assert.deepEqual(stub.requests.at(-1)?.body.messages.at(-1), {
        role: "user",
        content: "summarise this\n\na long log",
      });
      // Piped alone, it is the whole question.
      stub.enqueue({ text: "ok" });
      await nav(repo, ["chat"], env(), "just this\n");
      assert.equal(stub.requests.at(-1)?.body.messages.at(-1)?.content, "just this");
    } finally {
      repo.cleanup();
    }
  });

  it("files an issue it was asked to, with -y, and commits it as the person", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue(
        {
          text: "Filing it.",
          toolCalls: [
            {
              name: "open_issue",
              arguments: { title: "Login times out", body: "On 3G.", labels: ["bug"] },
            },
          ],
        },
        { text: "Filed as #abcd1234." },
      );
      const done = await nav(repo, ["chat", "-y", "-m", "file a bug: login times out on 3G"], {
        ...env(),
        NAV_IDS: "abcd1234",
      });
      assert.equal(done.code, 0, done.stderr);
      assert.equal(done.stdout, "Filing it.\nFiled as #abcd1234.\n");
      assert.match(done.stderr, /← open_issue: opened #abcd1234/);
      assert.equal(subjects(repo)[0], "docs(issue): open #abcd1234");
      const file = readFileSync(
        join(
          repo.dir,
          ".navbook/issues/open",
          readdirSync(join(repo.dir, ".navbook/issues/open")).find((d) =>
            d.startsWith("abcd1234"),
          ) as string,
          "issue.md",
        ),
        "utf8",
      );
      assert.match(file, /^author: Nav Test <nav@test\.invalid>$/m);
      assert.match(file, /^labels: \[bug\]$/m);
      assert.deepEqual(lastToolAnswer(), {
        id: "abcd1234",
        path: ".navbook/issues/open/abcd1234-login-times-out",
        commit: "docs(issue): open #abcd1234",
      });
    } finally {
      repo.cleanup();
    }
  });

  it("changes nothing without -y when nobody can be asked, and tells the model so", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue(
        { toolCalls: [{ name: "open_issue", arguments: { title: "T", body: "B" } }] },
        { text: "It was not filed." },
      );
      const before = subjects(repo);
      const done = await nav(repo, ["chat", "-m", "file something"], env());
      assert.equal(done.code, 0, done.stderr);
      assert.match(done.stderr, /changes need -y when nobody can be asked; declined/);
      assert.deepEqual(subjects(repo), before);
      const answer = lastToolAnswer() as { declined: boolean; message: string };
      assert.equal(answer.declined, true);
      assert.match(answer.message, /Do not retry it/);
    } finally {
      repo.cleanup();
    }
  });

  it("answers a query for my issues from the tree, with me standing for the person", async () => {
    const repo = chatRepo();
    try {
      for (const [id, title, assignee] of [
        ["mine0001", "Mine", "nav@test.invalid"],
        ["them0001", "Theirs", "other@test.invalid"],
      ] as const) {
        const opened = repo.nav(
          ["issue", "open", title, "-m", "Body.", "--assignee", assignee, "--commit"],
          { NAV_IDS: id },
        );
        assert.equal(opened.code, 0, opened.stderr);
      }
      stub.enqueue(
        { toolCalls: [{ name: "list_issues", arguments: { query: ["assignee:me"] } }] },
        { text: "One: #mine0001." },
      );
      const done = await nav(repo, ["chat", "-m", "what is assigned to me?"], env());
      assert.equal(done.code, 0, done.stderr);
      const answer = lastToolAnswer() as {
        count: number;
        rows: { id: string; assignees: string[] }[];
      };
      assert.equal(answer.count, 1);
      assert.equal(answer.rows[0]?.id, "mine0001");
      assert.deepEqual(answer.rows[0]?.assignees, ["nav@test.invalid"]);
      assert.match(done.stderr, /← list_issues: 1 issue/);
    } finally {
      repo.cleanup();
    }
  });

  it("finds overdue issues, and says what a query term it does not know means", async () => {
    const repo = chatRepo();
    try {
      repo.nav(["issue", "open", "Late", "-m", "B", "--deadline", "2026-07-01", "--commit"], {
        NAV_IDS: "late0001",
      });
      repo.nav(["issue", "open", "Early", "-m", "B", "--deadline", "2026-09-01", "--commit"], {
        NAV_IDS: "soon0001",
      });
      stub.enqueue(
        { toolCalls: [{ name: "list_issues", arguments: { query: ["deadline:overdue"] } }] },
        { toolCalls: [{ name: "list_prs", arguments: { query: ["deadline:overdue"] } }] },
        { text: "One." },
      );
      const done = await nav(repo, ["chat", "-m", "overdue?"], env());
      assert.equal(done.code, 0, done.stderr);
      const answers = (stub.requests.at(-1)?.body.messages ?? [])
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content ?? "null"));
      assert.deepEqual(
        answers[0].rows.map((row: { id: string }) => row.id),
        ["late0001"],
      );
      // A term a pull request cannot take is an error the model reads, not a crash.
      assert.match(answers[1].error, /deadline/);
      assert.match(done.stderr, /✗ list_prs/);
    } finally {
      repo.cleanup();
    }
  });

  it("shows a record in full, and reports one that is not there", async () => {
    const repo = chatRepo();
    try {
      repo.nav(["issue", "open", "Real", "-m", "The body.", "--commit"], { NAV_IDS: "real0001" });
      stub.enqueue(
        {
          toolCalls: [
            { id: "a", name: "show", arguments: { kind: "issue", ref: "real" } },
            { id: "b", name: "show", arguments: { kind: "issue", ref: "zzzz" } },
          ],
        },
        { text: "Done." },
      );
      const done = await nav(repo, ["chat", "-m", "show real and zzzz"], env());
      assert.equal(done.code, 0, done.stderr);
      const answers = (stub.requests.at(-1)?.body.messages ?? [])
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content ?? "null"));
      assert.equal(answers[0].id, "real0001");
      assert.equal(answers[0].body, "The body.");
      assert.deepEqual(answers[0].comments, []);
      assert.match(answers[1].error, /zzzz/);
      assert.equal(answers[1].code, "not-found");
    } finally {
      repo.cleanup();
    }
  });

  it("closes and reopens an issue", async () => {
    const repo = chatRepo();
    try {
      repo.nav(["issue", "open", "Done soon", "-m", "B", "--commit"], { NAV_IDS: "done0001" });
      stub.enqueue(
        {
          toolCalls: [
            { name: "close_issue", arguments: { ref: "done0001", resolution: "wontfix" } },
          ],
        },
        { toolCalls: [{ name: "reopen_issue", arguments: { ref: "done" } }] },
        { text: "Closed, then reopened." },
      );
      const done = await nav(repo, ["chat", "-y", "-m", "close then reopen done0001"], env());
      assert.equal(done.code, 0, done.stderr);
      assert.deepEqual(subjects(repo).slice(0, 2), [
        "docs(issue): reopen #done0001",
        "docs(issue): close #done0001",
      ]);
    } finally {
      repo.cleanup();
    }
  });

  it("reviews a pull request on the branch that carries it, from another branch", async () => {
    const repo = chatRepo();
    try {
      repo.git(["checkout", "--quiet", "-b", "feat/x"]);
      repo.write("x.txt", "x\n");
      repo.commitAll("feat: x");
      assert.equal(
        repo.nav(["pr", "open", "-m", "Please look.", "--commit"], { NAV_IDS: "prre0001" }).code,
        0,
      );
      repo.git(["checkout", "--quiet", "main"]);
      const tmp = join(repo.home, "tmp");
      mkdirSync(tmp, { recursive: true });

      stub.enqueue(
        {
          toolCalls: [
            {
              name: "review_pr",
              arguments: { ref: "prre0001", verdict: "approve", body: "Looks right." },
            },
          ],
        },
        { text: "Approved." },
      );
      const done = await nav(repo, ["chat", "-y", "-m", "approve prre0001"], {
        ...env(),
        TMPDIR: tmp,
      });
      assert.equal(done.code, 0, done.stderr);
      assert.equal(subjects(repo, "feat/x")[0], "docs(pr): review #prre0001");
      assert.equal(subjects(repo, "main")[0], "docs: initialize navbook");
      assert.deepEqual(readdirSync(tmp), [], "the temporary worktree went");
    } finally {
      repo.cleanup();
    }
  });

  it("opens a pull request from the branch it is told, not only the current one", async () => {
    const repo = chatRepo();
    try {
      repo.git(["checkout", "--quiet", "-b", "feat/y"]);
      repo.write("y.txt", "y\n");
      repo.commitAll("feat: y");
      repo.git(["checkout", "--quiet", "main"]);
      stub.enqueue(
        {
          toolCalls: [
            { name: "open_pr", arguments: { title: "Add y", body: "Adds y.", source: "feat/y" } },
          ],
        },
        { text: "Opened." },
      );
      const done = await nav(repo, ["chat", "-y", "-m", "open a PR for feat/y"], {
        ...env(),
        NAV_IDS: "prop0001",
      });
      assert.equal(done.code, 0, done.stderr);
      assert.equal(subjects(repo, "feat/y")[0], "docs(pr): open #prop0001");
      assert.deepEqual(lastToolAnswer(), {
        id: "prop0001",
        source: "feat/y",
        target: "main",
        commit: "docs(pr): open #prop0001",
      });
    } finally {
      repo.cleanup();
    }
  });

  it("emits one JSON event per line with --json, and nothing else on stdout", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue(
        {
          text: "Checking.",
          toolCalls: [
            { id: "c1", name: "list_issues", arguments: {} },
            { id: "c2", name: "open_issue", arguments: { title: "T", body: "B" } },
          ],
        },
        { text: "Done." },
      );
      const done = await nav(repo, ["chat", "--json", "-m", "go"], env());
      assert.equal(done.code, 0, done.stderr);
      const events = done.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      // Consecutive text deltas read as one "text" here: how a reply is split
      // into deltas is the endpoint's business.
      const kinds = events
        .map((event) => event.type)
        .filter((type, index, all) => type !== "text" || all[index - 1] !== "text");
      assert.deepEqual(kinds, [
        "text",
        "tool_call",
        "tool_result",
        "tool_call",
        "tool_result",
        "text",
        "done",
      ]);
      const text = events
        .filter((event) => event.type === "text")
        .map((event) => event.delta)
        .join("");
      assert.equal(text, "Checking.Done.");
      const tools = events.filter((event) => event.type !== "text");
      assert.deepEqual(tools[0], {
        type: "tool_call",
        id: "c1",
        name: "list_issues",
        arguments: {},
      });
      assert.equal(tools[1].ok, true);
      assert.equal(tools[1].decision, "read");
      assert.equal(
        tools[3].decision,
        "denied",
        "--json never asks, so without -y a write is declined",
      );
      assert.equal(events.at(-1).reason, "stop");
    } finally {
      repo.cleanup();
    }
  });

  it("says the key was refused, and exits 1", async () => {
    const repo = chatRepo();
    try {
      stub.enqueue({ status: 401, body: { error: { message: "Incorrect API key provided" } } });
      const done = await nav(repo, ["chat", "-m", "hi"], env());
      assert.equal(done.code, 1);
      assert.match(done.stderr, /refused the API key \(401\): Incorrect API key provided/);
      assert.equal(done.stderr.includes("test-key"), false, "never prints the key");
    } finally {
      repo.cleanup();
    }
  });

  it("says nothing is listening at an endpoint that is down", async () => {
    const repo = chatRepo();
    try {
      // A port that was just free, so nothing is listening on it.
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const { port } = probe.address() as AddressInfo;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const url = `http://127.0.0.1:${port}/v1`;
      const done = await nav(repo, ["chat", "-m", "hi"], env({ NAV_CHAT_BASE_URL: url }));
      assert.equal(done.code, 1);
      assert.match(
        done.stderr,
        new RegExp(`nothing is listening at ${url.replaceAll("/", "\\/")}`),
      );
    } finally {
      repo.cleanup();
    }
  });

  it("costs a listing nothing: not one of its modules is loaded", async () => {
    const repo = chatRepo();
    const log = join(repo.home, "imports.log");
    try {
      // A URL, not a path: `--import` reads a Windows path's drive as a scheme.
      const hook = pathToFileURL(join(PLUGIN, "test", "helpers", "import-log.mjs")).href;
      const listed = await nav(repo, ["issue", "list"], {
        NODE_OPTIONS: `--import=${hook}`,
        CHAT_IMPORT_LOG: log,
      });
      assert.equal(listed.code, 0, listed.stderr);
      assert.equal(existsSync(log), false, existsSync(log) ? readFileSync(log, "utf8") : "");
      stub.enqueue({ text: "hi" });
      await nav(repo, ["chat", "-m", "hi"], {
        ...env(),
        NODE_OPTIONS: `--import=${hook}`,
        CHAT_IMPORT_LOG: log,
      });
      assert.ok(existsSync(log), "the chat command does load it, so the hook works");
    } finally {
      rmSync(log, { force: true });
      repo.cleanup();
    }
  });
});
