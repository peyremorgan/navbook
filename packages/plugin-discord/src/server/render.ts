/**
 * What a thread shows: its card, its name, its tags, and a message per event.
 *
 * Pure, and the one place Discord's limits are kept: a message's content is at
 * most 2000 characters, an embed's description 4096, a field 1024, a title
 * 256, a whole embed 6000, a thread's name 100. Tracker text is never trusted
 * to stay inside them, and nothing it says can ping anybody: every message
 * names exactly who it may notify (`allowed_mentions`), and that is only ever
 * the people a change asks something of — an assignee, a reviewer.
 */

import type { CommentRecord, EntityRecord, ReviewPolicy } from "@navbook/core";
import type {
  ActionRow,
  Button,
  Embed,
  EmbedField,
  ForumTag,
  MessageBody,
} from "./discord/types.ts";
import { ButtonStyle } from "./discord/types.ts";
import { addressOf, type Core, type EntityEvent, valuesOf } from "./model.ts";

export interface RenderContext {
  core: Core;
  /** The web tracker, for links; null when the settings name none. */
  url: string | null;
  /** The Discord user an address is linked to, if any. */
  discordOf(address: string): string | null;
  policy: ReviewPolicy;
}

const COLORS = { open: 0x2da44e, draft: 0x6e7781, closed: 0x6e7781, merged: 0x8250df };
/** What Discord allows in one embed, title, description, fields and footer together. */
export const EMBED_LIMIT = 6_000;
const DESCRIPTION_LIMIT = 1_500;
const QUOTE_LIMIT = 1_500;
const FIELD_LIMIT = 1_024;

/** Where a record is in the web tracker, or null without one. */
export function linkOf(ctx: RenderContext, record: { kind: string; id: string }): string | null {
  if (ctx.url === null) return null;
  return `${ctx.url}/${record.kind === "pr" ? "prs" : "issues"}/${record.id}`;
}

/** The thread's name: the id first, so the bridge can find it again by name alone. */
export function threadName(record: { id: string; title: string }): string {
  return cut(`#${record.id} ${oneLine(record.title)}`, 100);
}

/** The id a thread's name says it is about, or null for a thread the bridge did not name. */
export function idOfThreadName(name: string | undefined): string | null {
  const match = /^#([a-z][a-z0-9]{7})(?:\s|$)/.exec(name ?? "");
  return match ? (match[1] as string) : null;
}

/** An embed's size as Discord counts it: every text in it, in characters. */
export function embedSize(embed: Embed): number {
  const length = (value: string | undefined): number => Array.from(value ?? "").length;
  return (
    length(embed.title) +
    length(embed.description) +
    length(embed.footer?.text) +
    (embed.fields ?? []).reduce((sum, field) => sum + length(field.name) + length(field.value), 0)
  );
}

/**
 * Bring an embed within {@link EMBED_LIMIT}: the description gives way
 * first, then the longest fields, a record with a hundred assignees and a
 * long list of labels being still a record whose card must be drawn.
 */
function fit(embed: Embed): void {
  let over = embedSize(embed) - EMBED_LIMIT;
  if (over <= 0) return;
  if (embed.description !== undefined) {
    const length = Array.from(embed.description).length;
    embed.description = excerpt(embed.description, Math.max(200, length - over - 1));
    over = embedSize(embed) - EMBED_LIMIT;
  }
  while (over > 0) {
    const longest = (embed.fields ?? []).reduce<EmbedField | null>(
      (best, field) =>
        best === null || Array.from(field.value).length > Array.from(best.value).length
          ? field
          : best,
      null,
    );
    const length = longest === null ? 0 : Array.from(longest.value).length;
    if (longest === null || length <= 64) break;
    longest.value = cut(longest.value, Math.max(64, length - over));
    over = embedSize(embed) - EMBED_LIMIT;
  }
}

/** The status as a person reads it, including a draft and why an issue was closed. */
export function statusLabel(record: EntityRecord): string {
  if (record.kind === "pr" && record.status === "open" && record.fm.draft === true) return "Draft";
  const base = record.status.charAt(0).toUpperCase() + record.status.slice(1);
  const resolution = record.fm.resolution;
  return record.status === "closed" && typeof resolution === "string" && resolution !== ""
    ? `${base} · ${oneLine(resolution)}`
    : base;
}

/** The forum tag names a record should carry: its status, then its labels. */
export function tagNames(core: Core, record: EntityRecord): string[] {
  const status =
    record.kind === "pr" && record.status === "open" && record.fm.draft === true
      ? "draft"
      : record.status;
  return [status, ...core.readLabels(record.fm)];
}

/**
 * The forum's tags for those names, matched without regard to case, at most
 * five as Discord allows. The bridge only applies tags the forum has: which
 * labels deserve one is the server's moderators' choice, not the tracker's.
 */
export function tagIds(names: readonly string[], available: readonly ForumTag[]): string[] {
  const byName = new Map(available.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const ids: string[] = [];
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 5);
}

/** The card that starts a thread, and is edited whenever the record changes. */
export function card(ctx: RenderContext, record: EntityRecord): MessageBody {
  const { core } = ctx;
  const fields: EmbedField[] = [];
  const add = (name: string, value: string, inline = true): void => {
    if (value !== "") fields.push({ name, value: cut(value, FIELD_LIMIT), inline });
  };
  add("Status", statusLabel(record));
  add("Author", person(ctx, String(record.fm.author ?? "")));
  add(
    "Assignees",
    core
      .readAssignees(record.fm)
      .map((each) => person(ctx, each))
      .join(", "),
  );
  if (record.kind === "pr") {
    const summary = core.reviewSummary(record, ctx.policy);
    add(
      "Reviews",
      summary.reviewers
        .map((reviewer) => `${REVIEW_ICONS[reviewer.state] ?? ""} ${person(ctx, reviewer.person)}`)
        .join("\n"),
    );
    if (summary.reviewers.length > 0 || summary.decision !== "pending") {
      add(
        "Decision",
        `${summary.decision} (${summary.approvals.given}/${summary.approvals.required} approvals)`,
      );
    }
    const source = text(record.fm.source);
    const target = text(record.fm.target);
    if (source !== "" || target !== "")
      add("Branch", `\`${source || "?"}\` → \`${target || "?"}\``);
  }
  add("Labels", core.readLabels(record.fm).map(oneLine).join(", "));
  add("Milestone", oneLine(text(record.fm.milestone)));
  add("Deadline", core.readDeadline(record.fm) ?? "");
  const parent = core.readParent(record.fm);
  if (parent !== null) add("Parent", `#${parent}`);
  add("Comments", String(record.comments.length));

  const embed: Embed = {
    title: cut(`#${record.id} ${oneLine(record.title)}`, 256),
    description: excerpt(record.body, DESCRIPTION_LIMIT),
    color:
      record.kind === "pr" && statusLabel(record) === "Draft"
        ? COLORS.draft
        : (COLORS[record.status as keyof typeof COLORS] ?? COLORS.closed),
    fields,
    footer: { text: `navbook:${record.id}` },
  };
  const link = linkOf(ctx, record);
  if (link !== null) embed.url = link;
  const created = text(record.fm.created);
  if (!Number.isNaN(Date.parse(created))) embed.timestamp = new Date(created).toISOString();
  fit(embed);
  return {
    embeds: [embed],
    components: [buttons(core, record)],
    allowed_mentions: { parse: [] },
  };
}

const REVIEW_ICONS: Record<string, string> = {
  approve: "✅",
  "request-changes": "❌",
  commented: "👀",
  pending: "⏳",
};

/**
 * What can be done from the card, depending on what the record is now.
 *
 * Each button's id is `nav:<action>:<entity id>`, and a review's carries the
 * revision the card shows after it: an approval is of what was seen, and one
 * pressed after a new revision is refused rather than bound to code nobody
 * looked at.
 */
function buttons(core: Core, record: EntityRecord): ActionRow {
  const button = (style: number, label: string, action: string, extra?: string): Button => ({
    type: 2,
    style,
    label,
    custom_id: actionId(action, record.id, extra),
  });
  const row: Button[] = [];
  if (record.kind === "pr") {
    if (record.status === "open") {
      const head = (core.latestRevision(record.fm) ?? "").slice(0, 12) || undefined;
      row.push(button(ButtonStyle.Success, "Approve", "approve", head));
      row.push(button(ButtonStyle.Danger, "Request changes", "changes", head));
    }
    row.push(button(ButtonStyle.Secondary, "Comment", "comment"));
  } else {
    row.push(button(ButtonStyle.Secondary, "Comment", "comment"));
    if (record.status === "open") {
      row.push(button(ButtonStyle.Primary, "Assign to me", "assign-me"));
      row.push(button(ButtonStyle.Danger, "Close", "close"));
    } else {
      row.push(button(ButtonStyle.Primary, "Reopen", "reopen"));
    }
  }
  return { type: 1, components: row };
}

/** A component's id: `nav:<action>:<entity id>[:<extra>]`, well under Discord's 100 characters. */
export function actionId(action: string, id: string, extra?: string): string {
  return extra === undefined ? `nav:${action}:${id}` : `nav:${action}:${id}:${extra}`;
}

/** The parts of a component's id, or null for one the bridge did not make. */
export function parseActionId(
  customId: string,
): { action: string; id: string; extra: string | undefined } | null {
  const match = /^nav:([a-z-]+):([a-z][a-z0-9]{7})(?::([^:]+))?$/.exec(customId);
  if (match === null) return null;
  return { action: match[1] as string, id: match[2] as string, extra: match[3] };
}

/**
 * The messages a thread is told for `events`, in order. Fields are told only
 * when a rule watches them (`watched`); the rest change the card alone.
 */
export function messages(
  ctx: RenderContext,
  record: EntityRecord | null,
  last: { kind: string; title: string },
  events: readonly EntityEvent[],
  watched: ReadonlySet<string>,
): MessageBody[] {
  const out: MessageBody[] = [];
  for (const event of events) {
    const body = messageFor(ctx, record, last, event, watched);
    if (body !== null) out.push(body);
  }
  return out;
}

/** The message one event makes, or null for one that changes only the card. */
export function messageFor(
  ctx: RenderContext,
  record: EntityRecord | null,
  last: { kind: string; title: string },
  event: EntityEvent,
  watched: ReadonlySet<string>,
): MessageBody | null {
  const noun = last.kind === "pr" ? "pull request" : "issue";
  switch (event.type) {
    case "opened":
      return null;
    case "gone":
      return quiet(
        last.kind === "pr"
          ? "🗑️ This pull request is no longer on any branch the tracker can see."
          : "🗑️ This issue was deleted.",
      );
    case "status": {
      if (event.to === "closed") {
        return quiet(
          `🔒 Closed${event.resolution === null ? "" : ` as ${oneLine(event.resolution)}`}.`,
        );
      }
      if (event.to === "merged") {
        const by = record === null ? null : ctx.core.readMerged(record.fm)?.by;
        return quiet(
          `🟣 Merged${typeof by === "string" && by !== "" ? ` by ${person(ctx, by)}` : ""}.`,
        );
      }
      return quiet(`🔓 Reopened.`);
    }
    case "retitled":
      return quiet(`✏️ Retitled: “${oneLine(event.from)}” → “${oneLine(event.to)}”.`);
    case "assigned":
      return peopleMessage(ctx, "👤 Assigned to", "Unassigned:", event.added, event.removed);
    case "reviewers":
      return peopleMessage(
        ctx,
        "👀 Review requested from",
        "No longer asked to review:",
        event.added,
        event.removed,
      );
    case "revised":
      return quiet(
        `🔁 New revision${event.heads.length === 1 ? "" : "s"}: ${event.heads
          .map((head) => `\`${head.slice(0, 7)}\``)
          .join(", ")}.`,
      );
    case "field": {
      if (!watched.has(event.key)) return null;
      const before = valuesOf(event.before).map(oneLine).join(", ") || "—";
      const after = valuesOf(event.after).map(oneLine).join(", ") || "—";
      return quiet(`🏷️ **${event.key}**: ${before} → ${after}.`);
    }
    case "comment": {
      const comment = record?.comments.find((each) => each.id === event.id);
      if (comment === undefined) return null;
      return commentMessage(ctx, comment, noun);
    }
    default:
      return null;
  }
}

function commentMessage(ctx: RenderContext, comment: CommentRecord, noun: string): MessageBody {
  const fm = comment.parsed.fm;
  const verdict = text(fm.verdict);
  const who = `**${person(ctx, comment.author)}**`;
  const headline =
    verdict === "approve"
      ? `✅ ${who} approved this ${noun}`
      : verdict === "request-changes"
        ? `❌ ${who} requested changes`
        : verdict === "comment"
          ? `👀 ${who} reviewed this ${noun}`
          : `💬 ${who} commented`;
  const file = text(fm.file);
  const anchor =
    file === "" ? "" : ` on \`${oneLine(file)}${text(fm.line) === "" ? "" : `:${text(fm.line)}`}\``;
  const quoted = quote(comment.body);
  return quiet(cut(`${headline}${anchor}:${quoted === "" ? "" : `\n${quoted}`}`, 2_000));
}

function peopleMessage(
  ctx: RenderContext,
  addedLabel: string,
  removedLabel: string,
  added: readonly string[],
  removed: readonly string[],
): MessageBody {
  const lines: string[] = [];
  const pinged: string[] = [];
  if (added.length > 0) {
    lines.push(`${addedLabel} ${added.map((each) => person(ctx, each)).join(", ")}.`);
    for (const each of added) {
      const id = ctx.discordOf(addressOf(each));
      if (id !== null && !pinged.includes(id)) pinged.push(id);
    }
  }
  if (removed.length > 0) {
    lines.push(`${removedLabel} ${removed.map((each) => personName(ctx, each)).join(", ")}.`);
  }
  return { content: cut(lines.join("\n"), 2_000), allowed_mentions: { parse: [], users: pinged } };
}

/** A message that notifies nobody. */
function quiet(content: string): MessageBody {
  return { content: cut(content, 2_000), allowed_mentions: { parse: [] } };
}

/** A person as a thread shows them: their Discord account when linked, else their name. */
export function person(ctx: RenderContext, value: string): string {
  if (value.trim() === "") return "";
  const id = ctx.discordOf(addressOf(value));
  return id === null ? personName(ctx, value) : `<@${id}>`;
}

/** A person's name, or address when the format records none. */
function personName(ctx: RenderContext, value: string): string {
  const parsed = ctx.core.parsePerson(value);
  return oneLine(parsed?.name ?? parsed?.email ?? value);
}

/** The start of a Markdown body, closed off if the cut fell inside a code fence. */
export function excerpt(body: string, limit: number): string {
  const trimmed = body.trim();
  if (trimmed.length <= limit) return trimmed;
  let cutText = `${trimmed.slice(0, limit - 1).trimEnd()}…`;
  if ((cutText.match(/```/g) ?? []).length % 2 === 1) cutText += "\n```";
  return cutText;
}

function quote(body: string): string {
  const shown = excerpt(body, QUOTE_LIMIT);
  if (shown === "") return "";
  return shown
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Control characters, which have no business in a Discord message. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** A line of tracker text as one line: no breaks, no control characters. */
export function oneLine(value: string): string {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** At most `limit` characters, counted as Discord counts them, with an ellipsis when cut. */
export function cut(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
