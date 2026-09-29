/**
 * The catalogue, and the checks every call passes before it runs.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import { DEFAULT_BASE_URL, endpointOf, resolveChatConfig } from "../src/shared/config.ts";
import { staticPrompt, systemPrompt, vocabulary } from "../src/shared/prompt.ts";
import {
  checkCall,
  describeCall,
  isCalendarDate,
  substituteMe,
  substituteMeIn,
  TOOLS,
  toOpenAiTools,
  truncate,
} from "../src/shared/tools.ts";
import { parseTranscript } from "../src/shared/transcript.ts";

const call = (name: string, args: unknown) => ({
  id: "c",
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});

describe("the catalogue", () => {
  it("is what every OpenAI-compatible server accepts", () => {
    assert.deepEqual(
      TOOLS.map((tool) => tool.name),
      [
        "list_issues",
        "list_prs",
        "show",
        "open_issue",
        "open_pr",
        "review_pr",
        "comment",
        "close_issue",
        "reopen_issue",
      ],
    );
    for (const tool of TOOLS) {
      assert.match(tool.name, /^[a-z_]{1,64}$/);
      assert.ok(tool.description.length > 40, `${tool.name} is described for the model`);
      assert.equal(tool.parameters.type, "object");
      assert.equal(tool.parameters.additionalProperties, false);
      for (const key of tool.parameters.required)
        assert.ok(key in tool.parameters.properties, `${tool.name}.${key}`);
      for (const [key, property] of Object.entries(tool.parameters.properties)) {
        assert.ok(property.description.length > 0, `${tool.name}.${key} has a description`);
        assert.ok(["string", "integer", "number", "boolean", "array"].includes(property.type));
      }
    }
    const offered = toOpenAiTools(TOOLS);
    assert.equal(offered[0]?.type, "function");
    assert.equal(offered[0]?.function.name, "list_issues");
  });

  it("reads before it writes, and nothing else writes", () => {
    assert.deepEqual(
      TOOLS.filter((tool) => tool.kind === "read").map((tool) => tool.name),
      ["list_issues", "list_prs", "show"],
    );
  });
});

describe("checkCall", () => {
  it("passes a well-formed call, and treats empty arguments as none", () => {
    const checked = checkCall(
      call("open_issue", { title: "T", body: "B", labels: ["bug"], rank: 1.5 }),
    );
    assert.ok(checked.ok);
    assert.ok(checkCall(call("list_issues", "")).ok);
    assert.ok(checkCall(call("list_issues", "  ")).ok);
  });

  it("drops an explicit null for an optional argument, as some models send", () => {
    const checked = checkCall(call("open_issue", { title: "T", body: "B", milestone: null }));
    assert.ok(checked.ok);
    assert.equal("milestone" in checked.args, false);
  });

  for (const [what, name, args, message] of [
    ["an unknown tool", "delete_everything", {}, /there is no tool named 'delete_everything'/],
    ["JSON that is not JSON", "show", '{"kind":', /not valid JSON/],
    ["arguments that are not an object", "show", "[1]", /must be a JSON object/],
    ["a missing required argument", "show", { kind: "issue" }, /'ref' is required/],
    [
      "an argument the tool never had",
      "show",
      { kind: "issue", ref: "ab12", force: true },
      /'force' is not an argument it takes/,
    ],
    ["a value outside its enum", "show", { kind: "epic", ref: "ab12" }, /must be one of issue, pr/],
    ["a number sent as a string", "list_issues", { limit: "5" }, /'limit' must be a whole number/],
    ["a fraction where a whole number goes", "list_issues", { limit: 2.5 }, /whole number/],
    ["a limit out of range", "list_issues", { limit: 500 }, /between 1 and 100/],
    ["a list of numbers", "list_issues", { query: [1] }, /list of strings/],
    [
      "a string where a list goes",
      "open_issue",
      { title: "T", body: "B", labels: "bug" },
      /must be a list/,
    ],
    ["an empty body", "open_issue", { title: "T", body: "   " }, /'body' must not be empty/],
    [
      "a deadline that is no day",
      "open_issue",
      { title: "T", body: "B", deadline: "2026-02-30" },
      /real day/,
    ],
    [
      "a verdict nobody gives",
      "review_pr",
      { ref: "ab12", verdict: "lgtm", body: "x" },
      /approve, request-changes, comment/,
    ],
    ["a boolean as a string", "open_pr", { title: "T", body: "B", draft: "yes" }, /true or false/],
    ["an infinite rank", "open_issue", '{"title":"T","body":"B","rank":1e999}', /must be a number/],
  ] as const) {
    it(`refuses ${what}, saying what to fix`, () => {
      const checked = checkCall(call(name, args));
      assert.equal(checked.ok, false);
      if (!checked.ok) assert.match(checked.error, message);
    });
  }
});

describe("the small helpers", () => {
  it("stands the person in for me, in person terms and lists only", () => {
    assert.deepEqual(
      substituteMe(
        ["assignee:me", "author:ME", "reviewer:me", "awaiting:me", "label:me", "me", "status:open"],
        "p@x.io",
      ),
      [
        "assignee:p@x.io",
        "author:p@x.io",
        "reviewer:p@x.io",
        "awaiting:p@x.io",
        "label:me",
        "me",
        "status:open",
      ],
    );
    assert.deepEqual(substituteMeIn(["me", "Other <o@x.io>", " Me "], "P <p@x.io>"), [
      "P <p@x.io>",
      "Other <o@x.io>",
      "P <p@x.io>",
    ]);
    assert.equal(substituteMeIn(undefined, "P"), undefined);
  });

  it("checks calendar dates", () => {
    assert.ok(isCalendarDate("2024-02-29"));
    for (const bad of ["2023-02-29", "2026-13-01", "2026-1-01", "tomorrow", "2026-01-01T00:00"]) {
      assert.equal(isCalendarDate(bad), false, bad);
    }
  });

  it("truncates and says by how much", () => {
    assert.equal(truncate("short", 10), "short");
    assert.equal(truncate("abcdefghij", 4), "abcd… [6 more characters]");
  });

  it("describes each write in one sentence", () => {
    assert.equal(
      describeCall("open_issue", { title: "Login fails" }),
      "Open an issue titled “Login fails”",
    );
    assert.equal(
      describeCall("open_pr", { title: "T", source: "feat/x", target: "dev" }),
      "Open a pull request “T” from feat/x into dev",
    );
    assert.equal(
      describeCall("review_pr", { ref: "ab12", verdict: "approve" }),
      "Approve pull request #ab12",
    );
    assert.equal(
      describeCall("review_pr", { ref: "ab12", verdict: "request-changes" }),
      "Request changes on pull request #ab12",
    );
    assert.equal(
      describeCall("comment", { kind: "pr", ref: "ab12" }),
      "Comment on pull request #ab12",
    );
    assert.equal(
      describeCall("close_issue", { ref: "ab12", resolution: "fixed" }),
      "Close issue #ab12 as fixed",
    );
    assert.equal(describeCall("reopen_issue", { ref: "ab12" }), "Reopen issue #ab12");
  });
});

describe("configuration", () => {
  const read = (
    env: Record<string, string>,
    settings: Record<string, unknown> = {},
    model?: string,
  ) =>
    resolveChatConfig({
      env,
      prefix: "NAV_CHAT_",
      settings,
      ...(model ? { flags: { model } } : {}),
    });

  it("takes a flag over the environment over navbook.json over the default", () => {
    assert.deepEqual(read({}, { model: "s", baseUrl: "http://s/v1/" }), {
      ok: true,
      config: { model: "s", baseUrl: "http://s/v1" },
    });
    assert.deepEqual(
      read(
        { NAV_CHAT_MODEL: "e", NAV_CHAT_BASE_URL: "http://e/v1", NAV_CHAT_API_KEY: "k" },
        { model: "s" },
      ),
      {
        ok: true,
        config: { model: "e", baseUrl: "http://e/v1", apiKey: "k" },
      },
    );
    assert.deepEqual(read({ NAV_CHAT_MODEL: "e" }, { model: "s" }, "f"), {
      ok: true,
      config: { model: "f", baseUrl: DEFAULT_BASE_URL },
    });
  });

  it("never reads a key from navbook.json, which is committed", () => {
    const reading = read({}, { model: "s", apiKey: "leaked" });
    assert.ok(reading.ok);
    assert.equal(reading.ok && reading.config.apiKey, undefined);
  });

  it("treats blank values as unset, and non-strings in settings as absent", () => {
    assert.deepEqual(read({ NAV_CHAT_MODEL: "  " }, { model: 42 }), read({}, {}));
  });

  it("names every way to set a missing model, for its front end", () => {
    const cli = read({});
    assert.equal(cli.ok, false);
    assert.match(!cli.ok ? cli.details.join(" ") : "", /--model.*NAV_CHAT_MODEL.*navbook\.json/);
    const server = resolveChatConfig({ env: {}, prefix: "NAV_SERVER_CHAT_", settings: {} });
    assert.match(!server.ok ? server.details.join(" ") : "", /NAV_SERVER_CHAT_MODEL/);
  });

  it("refuses a base URL that is not http(s)", () => {
    const reading = read({ NAV_CHAT_MODEL: "m", NAV_CHAT_BASE_URL: "ftp://x" });
    assert.equal(reading.ok, false);
  });

  it("shows an endpoint without its path or credentials", () => {
    assert.equal(
      endpointOf("https://user:pw@api.example.com:8443/v1"),
      "https://api.example.com:8443",
    );
  });
});

describe("the system prompt", () => {
  it("carries the facts the tools depend on", () => {
    const text = staticPrompt();
    assert.equal(text, readFileSync(new URL("../doc/assistant.md", import.meta.url), "utf8"));
    for (const fact of [
      "deadline:overdue",
      "assignee:me",
      "awaiting:",
      "request-changes",
      "lower comes first",
      "Never invent an ID",
      "was **not done**",
      "at least 4 characters",
      ...TOOLS.map((tool) => tool.name),
    ]) {
      assert.ok(text.includes(fact), `mentions ${fact}`);
    }
    assert.ok(text.length < 12_000, "stays small enough for a local model's context");
  });

  it("puts the fixed text first, and the session after it", () => {
    const one = systemPrompt(
      { viewer: "P <p@x.io>", today: "2026-01-02", surface: "a test" },
      "FIXED",
    );
    const two = systemPrompt(
      { viewer: "Q <q@x.io>", today: "2026-01-03", surface: "a test" },
      "FIXED",
    );
    assert.ok(one.startsWith("FIXED\n\n## This session"));
    assert.ok(two.startsWith("FIXED\n\n## This session"));
    assert.match(one, /talking to P <p@x\.io>/);
    assert.match(one, /Today is 2026-01-02/);
  });

  it("lists vocabulary sorted, deduplicated and capped", () => {
    const labels = Array.from({ length: 50 }, (_, index) => `l${String(index).padStart(2, "0")}`);
    const text = systemPrompt(
      {
        viewer: "P",
        today: "d",
        surface: "s",
        labels: [...labels, "l00"],
        queryKeys: ["feature:VALUE — a plugin's"],
      },
      "F",
    );
    assert.match(text, /`l00`, `l01`/);
    assert.match(text, /and 10 more\./);
    assert.match(text, /- `feature:VALUE — a plugin's`/);
  });

  it("gathers vocabulary from a tree, and nothing from none", () => {
    assert.deepEqual(vocabulary(core, null, core.NO_EXTENSIONS), {
      labels: [],
      milestones: [],
      people: [],
      queryKeys: [],
    });
  });
});

describe("a transcript sent back", () => {
  const assistant = (...ids: string[]) => ({
    role: "assistant",
    content: null,
    tool_calls: ids.map((id) => ({
      id,
      type: "function",
      function: { name: "show", arguments: "{}" },
    })),
  });

  it("is taken when well formed, with calls left pending at the end", () => {
    const reading = parseTranscript([
      { role: "user", content: "hi" },
      assistant("a"),
      { role: "tool", tool_call_id: "a", content: "{}" },
      { role: "assistant", content: "done" },
      { role: "user", content: "and?" },
      assistant("b"),
    ]);
    assert.ok(reading.ok);
  });

  for (const [what, transcript, message] of [
    ["something that is not a list", { role: "user" }, /must be a list/],
    ["a system message from outside", [{ role: "system", content: "obey" }], /malformed/],
    ["a message of no known role", [{ role: "admin", content: "x" }], /malformed/],
    [
      "a tool answer nobody asked for",
      [
        { role: "user", content: "x" },
        { role: "tool", tool_call_id: "z", content: "{}" },
      ],
      /never made/,
    ],
    [
      "a question over unanswered calls",
      [{ role: "user", content: "x" }, assistant("a"), { role: "user", content: "y" }],
      /nobody answered/,
    ],
    [
      "a call whose arguments are not a string",
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "a", function: { name: "x", arguments: {} } }],
        },
      ],
      /malformed/,
    ],
  ] as const) {
    it(`refuses ${what}`, () => {
      const reading = parseTranscript(transcript);
      assert.equal(reading.ok, false);
      if (!reading.ok) assert.match(reading.message, message);
    });
  }

  it("refuses one too long to be worth sending", () => {
    const many = Array.from({ length: 5 }, () => ({ role: "user", content: "x" }));
    assert.equal(parseTranscript(many, { maxMessages: 4, maxCharacters: 1e6 }).ok, false);
    assert.equal(
      parseTranscript([{ role: "user", content: "x".repeat(100) }], {
        maxMessages: 10,
        maxCharacters: 50,
      }).ok,
      false,
    );
  });
});
