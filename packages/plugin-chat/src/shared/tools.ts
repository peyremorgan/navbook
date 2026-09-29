/**
 * What the assistant may do: one catalogue, for every front end.
 *
 * Each tool is data — a name, a description written for the model, a JSON
 * Schema for its arguments, and whether it reads or writes. The CLI and the
 * server each carry an executor that performs them against the tree, but what
 * the model is offered, and how its arguments are checked, is decided here
 * once, so the assistant behaves the same in a terminal as in a browser.
 *
 * The schemas are deliberately plain — flat objects, strings, integers,
 * booleans, arrays of strings, enums — because that is the subset every
 * OpenAI-compatible server accepts, local ones included, and small models
 * fill it in more reliably than anything clever. Nothing is trusted because
 * the schema said so: {@link checkArguments} checks every call before it runs,
 * and a call that fails goes back to the model as an error it can correct.
 */

/** One property of a tool's arguments. */
export type JsonSchemaProperty =
  | { type: "string"; description: string; enum?: readonly string[] }
  | { type: "integer" | "number" | "boolean"; description: string }
  | {
      type: "array";
      description: string;
      items: { type: "string"; enum?: readonly string[] };
    };

/** A tool's arguments: always an object, never more than one level deep. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: readonly string[];
  additionalProperties: false;
}

export interface ToolSpec {
  name: ToolName;
  /** For the model: what it does, when to use it, what it returns. */
  description: string;
  parameters: JsonSchema;
  /** Reads run at once; every write waits for the person to approve it. */
  kind: "read" | "write";
  /** A check the schema cannot express; a message the model can act on, or null. */
  check?: (args: Record<string, unknown>) => string | null;
}

/** The arguments each tool takes, as the model sends them. */
export interface ToolArgs {
  list_issues: { query?: string[]; limit?: number };
  list_prs: { query?: string[]; limit?: number };
  show: { kind: "issue" | "pr"; ref: string };
  open_issue: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
    milestone?: string;
    rank?: number;
    deadline?: string;
    parent?: string;
  };
  open_pr: {
    title: string;
    body: string;
    source?: string;
    target?: string;
    draft?: boolean;
    reviewers?: string[];
    labels?: string[];
    assignees?: string[];
    milestone?: string;
  };
  review_pr: { ref: string; verdict: Verdict; body: string };
  comment: { kind: "issue" | "pr"; ref: string; body: string; reply_to?: string };
  close_issue: { ref: string; resolution?: string; duplicate_of?: string };
  reopen_issue: { ref: string };
}

export type ToolName = keyof ToolArgs;
export type Verdict = "approve" | "request-changes" | "comment";

/** A call the model made, as it made it. */
export interface ToolCall {
  id: string;
  name: string;
  /** The arguments exactly as they arrived: a JSON string, perhaps malformed. */
  arguments: string;
}

/** What a commit an executor made looked like, for saying so. */
export interface CommitSummary {
  committed: boolean;
  subject: string;
  pushed: boolean;
}

/** What running a tool came to. */
export interface ToolResult {
  ok: boolean;
  /** What the model is shown: the data, or `{ error }`. */
  content: unknown;
  /** One line for a person watching: "12 issues", "opened #ab12cd34". */
  summary: string;
  /** The commit a write made. */
  commit?: CommitSummary;
  /** The record a write made or changed, for linking to it. */
  record?: { kind: "issue" | "pr"; id: string };
}

/** Performs the tools against a tree. One per front end. */
export interface ToolExecutor {
  execute<N extends ToolName>(
    name: N,
    args: ToolArgs[N],
    signal?: AbortSignal,
  ): Promise<ToolResult>;
}

/** How many rows a listing hands the model before saying how many more there are. */
export const LIST_LIMIT = 30;
export const LIST_LIMIT_MAX = 100;
/** How much of an entity's body `show` hands the model. */
export const BODY_LIMIT = 4000;
/** How much of each comment, and how many of the latest. */
export const COMMENT_LIMIT = 1500;
export const COMMENTS_SHOWN = 20;

const QUERY_HELP =
  "Query terms, ANDed, as `nav issue list` takes them: `status:open`, `status:closed`, " +
  "`label:NAME`, `assignee:EMAIL`, `author:EMAIL`, `milestone:NAME`, `deadline:overdue`, " +
  "`deadline:none`, or a bare word to search titles, bodies and comments. `me` stands for " +
  "the person you are talking to, e.g. `assignee:me`. Without a status term only open ones " +
  "are listed.";

const PERSON = "a person as `Name <email>` or a bare email; `me` is the person you are talking to";

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "list_issues",
    kind: "read",
    description:
      "List issues matching a query, newest first. Use it for any question about which issues " +
      "exist: what is open, what is assigned to someone, what is overdue, what mentions a word. " +
      "Returns each issue's id, title, status, labels, assignees, milestone, deadline and rank, " +
      "and how many more matched than were returned.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "array", items: { type: "string" }, description: QUERY_HELP },
        limit: {
          type: "integer",
          description: `How many to return, 1-${LIST_LIMIT_MAX} (default ${LIST_LIMIT}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    check: checkLimit,
  },
  {
    name: "list_prs",
    kind: "read",
    description:
      "List pull requests matching a query, newest first, from every branch that carries one. " +
      "Beyond the issue terms it takes `reviewer:EMAIL` (asked to review), `awaiting:EMAIL` " +
      "(asked and not yet answered the latest revision) and `review:approved`, " +
      "`review:changes-requested` or `review:pending`; `deadline:` does not apply. Returns each " +
      "one's id, title, status, source and target branches, reviewers and review decision.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "array",
          items: { type: "string" },
          description: `${QUERY_HELP} Also \`reviewer:\`, \`awaiting:\` and \`review:\`.`,
        },
        limit: {
          type: "integer",
          description: `How many to return, 1-${LIST_LIMIT_MAX} (default ${LIST_LIMIT}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    check: checkLimit,
  },
  {
    name: "show",
    kind: "read",
    description:
      "Read one issue or pull request in full: its fields, its description and its latest " +
      "comments, and for a pull request its revisions and who has reviewed it. Use it before " +
      "acting on something, to be sure the id is the one meant.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["issue", "pr"], description: "Which kind of record." },
        ref: {
          type: "string",
          description: "Its id, or an unambiguous prefix of at least 4 characters.",
        },
      },
      required: ["kind", "ref"],
      additionalProperties: false,
    },
  },
  {
    name: "open_issue",
    kind: "write",
    description:
      "File a new issue. The person is shown what will be written and approves it first. The " +
      "body is Markdown and must not be empty; write a clear first sentence. Returns the new " +
      "issue's id.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line saying what is wrong or wanted." },
        body: { type: "string", description: "The description, in Markdown." },
        labels: { type: "array", items: { type: "string" }, description: "Labels, e.g. `bug`." },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: `Who takes it: ${PERSON}.`,
        },
        milestone: { type: "string", description: "The milestone it belongs to." },
        rank: { type: "number", description: "Its priority: a number, lower first." },
        deadline: { type: "string", description: "When it is wanted, as YYYY-MM-DD." },
        parent: {
          type: "string",
          description: "The id of an issue to file it under, as a subtask.",
        },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    check: (args) =>
      checkText(args, ["title", "body"]) ??
      (typeof args.deadline === "string" && !isCalendarDate(args.deadline)
        ? "deadline must be a real day written YYYY-MM-DD"
        : null),
  },
  {
    name: "open_pr",
    kind: "write",
    description:
      "Open a pull request proposing to merge a branch. The branch must already exist and carry " +
      "the work; the pull request is written on it. The person approves it first. Returns the " +
      "new pull request's id.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line saying what the change does." },
        body: { type: "string", description: "What changed and why, in Markdown." },
        source: {
          type: "string",
          description:
            "The branch carrying the work, without a remote prefix; the current one if omitted.",
        },
        target: {
          type: "string",
          description: "The branch to merge into; the default branch if omitted.",
        },
        draft: { type: "boolean", description: "True when it is not ready for review yet." },
        reviewers: {
          type: "array",
          items: { type: "string" },
          description: `Who to ask to review: ${PERSON}.`,
        },
        labels: { type: "array", items: { type: "string" }, description: "Labels." },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: `Who owns it: ${PERSON}.`,
        },
        milestone: { type: "string", description: "The milestone it belongs to." },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    check: (args) => checkText(args, ["title", "body"]),
  },
  {
    name: "review_pr",
    kind: "write",
    description:
      "Record a review of a pull request: approve it, request changes, or comment as a review. " +
      "The verdict binds to its latest revision. The person approves it first.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "The pull request's id or a prefix of it." },
        verdict: {
          type: "string",
          enum: ["approve", "request-changes", "comment"],
          description: "What the review concludes.",
        },
        body: { type: "string", description: "What the review says, in Markdown." },
      },
      required: ["ref", "verdict", "body"],
      additionalProperties: false,
    },
    check: (args) => checkText(args, ["body"]),
  },
  {
    name: "comment",
    kind: "write",
    description:
      "Add a comment to an issue or a pull request, optionally as a reply to one of its " +
      "comments. It is not a review: use review_pr to approve or request changes. The person " +
      "approves it first.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["issue", "pr"], description: "Which kind of record." },
        ref: { type: "string", description: "Its id or a prefix of it." },
        body: { type: "string", description: "The comment, in Markdown." },
        reply_to: { type: "string", description: "The id of the comment this answers." },
      },
      required: ["kind", "ref", "body"],
      additionalProperties: false,
    },
    check: (args) => checkText(args, ["body"]),
  },
  {
    name: "close_issue",
    kind: "write",
    description: "Close an issue, saying why. The person approves it first.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "The issue's id or a prefix of it." },
        resolution: {
          type: "string",
          description: "Why it ended: usually `fixed`, `wontfix`, `duplicate` or `invalid`.",
        },
        duplicate_of: {
          type: "string",
          description: "The id of the issue it duplicates, with resolution `duplicate`.",
        },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "reopen_issue",
    kind: "write",
    description: "Reopen a closed issue. The person approves it first.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "The issue's id or a prefix of it." } },
      required: ["ref"],
      additionalProperties: false,
    },
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function toolByName(name: string): ToolSpec | undefined {
  return BY_NAME.get(name as ToolName);
}

/** The catalogue in the shape the chat-completions API takes. */
export function toOpenAiTools(tools: readonly ToolSpec[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

/** A call made ready to run, or what is wrong with it, in words for the model. */
export type CheckedCall =
  | { ok: true; tool: ToolSpec; args: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse and check a call against its tool.
 *
 * Models get this wrong in every way there is — an unknown tool, JSON that is
 * not JSON, a number as a string, a field the schema never had — and each is
 * answered with what to fix rather than guessed at. An empty argument string
 * is an empty object: some servers send nothing for a tool without arguments.
 */
export function checkCall(call: ToolCall): CheckedCall {
  const tool = toolByName(call.name);
  if (!tool) {
    return {
      ok: false,
      error: `there is no tool named '${call.name}'; use one of ${TOOLS.map((t) => t.name).join(", ")}`,
    };
  }
  let raw: unknown;
  try {
    raw = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
  } catch {
    return { ok: false, error: `the arguments to ${tool.name} are not valid JSON` };
  }
  const problem = checkArguments(tool.parameters, raw);
  if (problem !== null) return { ok: false, error: `${tool.name}: ${problem}` };
  const args = raw as Record<string, unknown>;
  const semantic = tool.check?.(args) ?? null;
  if (semantic !== null) return { ok: false, error: `${tool.name}: ${semantic}` };
  return { ok: true, tool, args };
}

/** What is wrong with `raw` as arguments to `schema`, or null. */
export function checkArguments(schema: JsonSchema, raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "the arguments must be a JSON object";
  }
  const args = raw as Record<string, unknown>;
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) return `'${key}' is not an argument it takes`;
  }
  for (const key of schema.required) {
    if (args[key] === undefined || args[key] === null) return `'${key}' is required`;
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    const value = args[key];
    // An explicit null for an optional argument is how some models say "none".
    if (value === undefined || value === null) {
      delete args[key];
      continue;
    }
    const problem = checkValue(property, value);
    if (problem !== null) return `'${key}' ${problem}`;
  }
  return null;
}

function checkValue(property: JsonSchemaProperty, value: unknown): string | null {
  switch (property.type) {
    case "string":
      if (typeof value !== "string") return "must be a string";
      if (property.enum && !property.enum.includes(value)) {
        return `must be one of ${property.enum.join(", ")}`;
      }
      return null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : "must be a whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "array": {
      if (!Array.isArray(value)) return "must be a list";
      for (const item of value) {
        if (typeof item !== "string") return "must be a list of strings";
        if (property.items.enum && !property.items.enum.includes(item)) {
          return `may only hold ${property.items.enum.join(", ")}`;
        }
      }
      return null;
    }
  }
}

function checkText(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (typeof args[key] === "string" && (args[key] as string).trim() === "")
      return `'${key}' must not be empty`;
  }
  return null;
}

function checkLimit(args: Record<string, unknown>): string | null {
  const limit = args.limit;
  if (limit === undefined) return null;
  return typeof limit === "number" && limit >= 1 && limit <= LIST_LIMIT_MAX
    ? null
    : `'limit' must be between 1 and ${LIST_LIMIT_MAX}`;
}

/** True for `YYYY-MM-DD` naming a day that exists. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The person-valued query keys, where `me` means the person asking. */
const PERSON_KEYS = ["assignee", "author", "reviewer", "awaiting"];

/**
 * Stand the person in for `me`: in a query's person terms, and in a list of
 * people. Anywhere else `me` is a word like any other.
 */
export function substituteMe(terms: readonly string[], email: string): string[] {
  return terms.map((term) => {
    const colon = term.indexOf(":");
    if (colon === -1) return term;
    const key = term.slice(0, colon);
    return PERSON_KEYS.includes(key) && term.slice(colon + 1).toLowerCase() === "me"
      ? `${key}:${email}`
      : term;
  });
}

export function substituteMeIn(
  people: readonly string[] | undefined,
  viewer: string,
): string[] | undefined {
  return people?.map((person) => (person.trim().toLowerCase() === "me" ? viewer : person));
}

/** Cut `text` to `limit` characters, saying how much was left out. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [${text.length - limit} more characters]`;
}

/**
 * One sentence saying what a write will do, for the person approving it.
 *
 * Written from the arguments alone, so it reads the same wherever it is
 * shown and needs nothing looked up.
 */
export function describeCall(name: ToolName, raw: Record<string, unknown>): string {
  const args = raw as Record<string, string | undefined>;
  switch (name) {
    case "open_issue":
      return `Open an issue titled “${args.title}”`;
    case "open_pr": {
      const from = args.source ? ` from ${args.source}` : "";
      const into = args.target ? ` into ${args.target}` : "";
      return `Open a pull request “${args.title}”${from}${into}`;
    }
    case "review_pr": {
      const verdict =
        args.verdict === "approve"
          ? "Approve"
          : args.verdict === "request-changes"
            ? "Request changes on"
            : "Review";
      return `${verdict} pull request #${args.ref}`;
    }
    case "comment":
      return `Comment on ${args.kind === "pr" ? "pull request" : "issue"} #${args.ref}`;
    case "close_issue":
      return `Close issue #${args.ref}${args.resolution ? ` as ${args.resolution}` : ""}`;
    case "reopen_issue":
      return `Reopen issue #${args.ref}`;
    case "list_issues":
      return "List issues";
    case "list_prs":
      return "List pull requests";
    case "show":
      return `Read ${args.kind === "pr" ? "pull request" : "issue"} #${args.ref}`;
  }
}
