/**
 * The plugin's settings in `navbook.json` — `doc/spec.md`, "Settings".
 *
 * Committed and shared by everyone who clones, so nothing here is secret: the
 * bot's token is the server's environment's (doc/plugins.md, "Using them").
 * Read by three front ends — the server that runs the bridge, the CLI that
 * edits the `people` map, and `nav doctor` — which is why it is pure, and why
 * the one core function it needs is handed to it rather than imported: a
 * plugin is given the core its host runs (doc/plugins.md, "The package").
 */

/** The package name settings are declared under. */
export const PLUGIN_NAME = "@navbook/plugin-discord";

/** A Discord id: a snowflake, written as the decimal string Discord sends. */
export const SNOWFLAKE = /^\d{17,20}$/;

/** A frontmatter key a `field:` trigger may name (spec 02 §2.4: lowercase kebab-case). */
const FIELD_KEY = /^[a-z][a-z0-9-]*$/;

/** What opens an issue's thread, as a rule's `on` spells it. */
export type Trigger =
  | { kind: "open" }
  | { kind: "assign" }
  | { kind: "status"; status: "open" | "closed" }
  | { kind: "field"; key: string; value?: string };

/** When an issue gets a thread, and where. */
export interface IssueRule {
  channel: string;
  /** `root`: only issues that are nobody's subtask. */
  scope: "root" | "all";
  on: Trigger[];
  /** Query terms the issue must match as it stands then (spec 04 §4.3); none matches all. */
  match: string[];
}

export interface Settings {
  guild: string;
  /** The web tracker's address, without a trailing slash, for links; null when there is none. */
  url: string | null;
  /** Where every pull request gets a thread, or null for none. */
  prs: { channel: string } | null;
  issues: IssueRule[];
  /** Discord user id to the address it acts as. */
  people: Map<string, string>;
}

export type SettingsReading = { ok: true; settings: Settings } | { ok: false; problems: string[] };

/** The one core function the settings need: how the format reads a person (spec 02 §2.4). */
export interface PersonReader {
  parsePerson(text: string): { name?: string; email: string } | null;
}

const KEYS = ["guild", "url", "prs", "issues", "people"];
const RULE_KEYS = ["channel", "scope", "on", "match"];

/**
 * Read the settings block, reporting every fault rather than the first.
 *
 * Each fault names the key it is about, as `issues[1].on[0]`, because the
 * person reading it is about to open `navbook.json` and look for it.
 */
export function parseSettings(raw: unknown, core: PersonReader): SettingsReading {
  const problems: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, problems: ["the settings are not a JSON object"] };
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) problems.push(`${key}: not a setting this plugin reads`);
  }

  const guild = snowflake(raw.guild, "guild", problems, true);

  let url: string | null = null;
  if (raw.url !== undefined) {
    url = webUrl(raw.url);
    if (url === null) problems.push(`url: ${describe(raw.url)} is not an http(s) address`);
  }

  let prs: Settings["prs"] = null;
  if (raw.prs !== undefined) {
    if (!isPlainObject(raw.prs)) {
      problems.push("prs: not an object with a channel");
    } else {
      for (const key of Object.keys(raw.prs)) {
        if (key !== "channel") problems.push(`prs.${key}: not a setting this plugin reads`);
      }
      const channel = snowflake(raw.prs.channel, "prs.channel", problems, true);
      if (channel !== null) prs = { channel };
    }
  }

  const issues: IssueRule[] = [];
  if (raw.issues !== undefined) {
    if (!Array.isArray(raw.issues)) {
      problems.push("issues: not a list of rules");
    } else {
      raw.issues.forEach((rule, index) => {
        const parsed = parseRule(rule, `issues[${index}]`, problems);
        if (parsed !== null) issues.push(parsed);
      });
    }
  }

  const people = parsePeopleInto(raw.people, core, problems);

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, settings: { guild: guild as string, url, prs, issues, people } };
}

/**
 * Only the `people` map, from the plugin's block in a marker's text.
 *
 * What the server reads again at every sync, so a link committed from a
 * terminal takes effect without a restart. A map with faults reads as the
 * entries that have none, and the faults are returned beside them: a typo in
 * one person's entry is no reason to stop acting for everybody else.
 */
export function peopleOf(
  settings: unknown,
  core: PersonReader,
): { people: Map<string, string>; problems: string[] } {
  const problems: string[] = [];
  const raw = isPlainObject(settings) ? settings.people : undefined;
  return { people: parsePeopleInto(raw, core, problems), problems };
}

/** The entries that are sound; a fault for each that is not. */
function parsePeopleInto(
  raw: unknown,
  core: PersonReader,
  problems: string[],
): Map<string, string> {
  const people = new Map<string, string>();
  if (raw === undefined) return people;
  if (!isPlainObject(raw)) {
    problems.push("people: not an object of Discord user ids to addresses");
    return people;
  }
  for (const [id, value] of Object.entries(raw)) {
    const where = `people.${id}`;
    let fine = true;
    if (!SNOWFLAKE.test(id)) {
      problems.push(`${where}: ${describe(id)} is not a Discord user id`);
      fine = false;
    }
    const email = typeof value === "string" ? bareAddress(value, core) : null;
    if (email === null) {
      problems.push(`${where}: ${describe(value)} is not an email address`);
      fine = false;
    }
    if (fine) people.set(id, email as string);
  }
  return people;
}

/** An address with no display name, as the format reads one, or null. */
export function bareAddress(text: string, core: PersonReader): string | null {
  const person = core.parsePerson(text);
  if (person === null || person.name !== undefined || person.email !== text.trim()) return null;
  return person.email;
}

function parseRule(raw: unknown, where: string, problems: string[]): IssueRule | null {
  if (!isPlainObject(raw)) {
    problems.push(`${where}: not an object with a channel`);
    return null;
  }
  const before = problems.length;
  for (const key of Object.keys(raw)) {
    if (!RULE_KEYS.includes(key)) problems.push(`${where}.${key}: not a setting this plugin reads`);
  }
  const channel = snowflake(raw.channel, `${where}.channel`, problems, true);

  let scope: IssueRule["scope"] = "all";
  if (raw.scope !== undefined) {
    if (raw.scope === "root" || raw.scope === "all") scope = raw.scope;
    else problems.push(`${where}.scope: ${describe(raw.scope)} is neither "root" nor "all"`);
  }

  let on: Trigger[] = [{ kind: "open" }];
  if (raw.on !== undefined) {
    if (!Array.isArray(raw.on) || raw.on.length === 0) {
      problems.push(`${where}.on: not a non-empty list of triggers`);
    } else {
      on = [];
      raw.on.forEach((text, index) => {
        const trigger = typeof text === "string" ? parseTrigger(text) : null;
        if (trigger === null) problems.push(`${where}.on[${index}]: ${triggerFault(text)}`);
        else on.push(trigger);
      });
    }
  }

  let match: string[] = [];
  if (raw.match !== undefined) {
    if (typeof raw.match === "string") {
      match = raw.match.split(/\s+/).filter((term) => term !== "");
    } else if (Array.isArray(raw.match) && raw.match.every((term) => typeof term === "string")) {
      match = raw.match.map((term: string) => term.trim()).filter((term) => term !== "");
    } else {
      problems.push(`${where}.match: not query terms, as a string or a list of strings`);
    }
  }

  if (problems.length > before || channel === null) return null;
  return { channel, scope, on, match };
}

/**
 * One trigger, as written: `open`, `assign`, `status:open`, `status:closed`,
 * `field:<key>` or `field:<key>=<value>`. Null when it is none of those.
 */
export function parseTrigger(text: string): Trigger | null {
  const trimmed = text.trim();
  if (trimmed === "open") return { kind: "open" };
  if (trimmed === "assign") return { kind: "assign" };
  if (trimmed === "status:open" || trimmed === "status:closed") {
    return { kind: "status", status: trimmed === "status:open" ? "open" : "closed" };
  }
  if (!trimmed.startsWith("field:")) return null;
  const rest = trimmed.slice("field:".length);
  const equals = rest.indexOf("=");
  const key = (equals === -1 ? rest : rest.slice(0, equals)).trim();
  if (!FIELD_KEY.test(key)) return null;
  if (equals === -1) return { kind: "field", key };
  const value = rest.slice(equals + 1).trim();
  return value === "" ? null : { kind: "field", key, value };
}

function triggerFault(text: unknown): string {
  if (typeof text !== "string") return `${describe(text)} is not a trigger`;
  if (text.trim() === "closed" || text.trim() === "close") {
    return `${describe(text)} is not a trigger; use "status:closed"`;
  }
  if (text.trim().startsWith("status:")) {
    return `${describe(text)} is not a status an issue has; use "status:open" or "status:closed"`;
  }
  return `${describe(text)} is not a trigger: use open, assign, status:open, status:closed, field:<key> or field:<key>=<value>`;
}

function snowflake(
  value: unknown,
  where: string,
  problems: string[],
  required: boolean,
): string | null {
  if (value === undefined) {
    if (required) problems.push(`${where}: missing; a Discord id is needed here`);
    return null;
  }
  if (typeof value === "string" && SNOWFLAKE.test(value)) return value;
  problems.push(`${where}: ${describe(value)} is not a Discord id, written as a string of digits`);
  return null;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** A value as a fault message shows it: JSON, so it is one line whatever it holds. */
function describe(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
