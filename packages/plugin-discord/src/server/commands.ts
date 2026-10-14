/**
 * What people do from Discord — `doc/spec.md`, "Commands".
 *
 * One `/nav` command with a subcommand per action, a message command that
 * turns somebody's message into a comment, and the buttons on every card.
 * Anything that writes runs as the person the Discord account is linked to,
 * through the API's own operations (`host.api.execute`): the same checks,
 * the same commit, the same events as if they had used the web tracker. An
 * account linked to nobody is told how to link, and nothing is written or
 * shown: a record's card, or the ids and titles `id` completes, are what the
 * person could read in the tracker, and only a link says who that is.
 *
 * A link stands in for a sign-in, and answers only what an address can: a
 * server that also admits people by a token's claims, or by its verified
 * address, cannot ask Discord either. Such a server's accounts act for
 * nobody unless the operator says the links will do (`untrusted` is null).
 *
 * Discord wants an answer within three seconds. A write pulls and pushes, so
 * every write is answered "thinking…" at once and the answer edited in when
 * the write is done. A modal must be the very first answer, so what a modal
 * is about is found from what the bridge already holds, never by reading the
 * tree first.
 */

import type { EntityRecord, Identity } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import type { Bridge } from "./bridge.ts";
import type { DiscordRest } from "./discord/rest.ts";
import {
  type CommandDefinition,
  CommandType,
  EPHEMERAL,
  type Interaction,
  InteractionResponseType,
  InteractionType,
  type Modal,
  type ModalField,
  OptionType,
  type User,
} from "./discord/types.ts";
import { type LinkCodes, writePeople } from "./link.ts";
import { addressOf } from "./model.ts";
import { actionId, card, cut, oneLine, parseActionId } from "./render.ts";

/** The name of the message command, as Discord shows it in a message's menu. */
export const COMMENT_ON = "Comment on this issue/PR";

const ID_OPTION = {
  type: OptionType.String,
  name: "id",
  description: "the issue or pull request; this thread's when omitted",
  autocomplete: true,
};

/** The commands the bridge registers in its guild. */
export const COMMANDS: CommandDefinition[] = [
  {
    name: "nav",
    type: CommandType.ChatInput,
    description: "the tracker's issues and pull requests",
    contexts: [0],
    options: [
      {
        type: OptionType.SubCommand,
        name: "link",
        description: "link your Discord account to you in the tracker",
      },
      { type: OptionType.SubCommand, name: "unlink", description: "unlink your Discord account" },
      {
        type: OptionType.SubCommand,
        name: "whoami",
        description: "who your Discord account acts as",
      },
      {
        type: OptionType.SubCommand,
        name: "comment",
        description: "comment, as yourself",
        options: [
          {
            type: OptionType.String,
            name: "body",
            description: "what to say; a form opens when omitted",
            max_length: 4000,
          },
          ID_OPTION,
        ],
      },
      {
        type: OptionType.SubCommand,
        name: "review",
        description: "review a pull request's latest revision, as yourself",
        options: [
          {
            type: OptionType.String,
            name: "verdict",
            description: "your verdict",
            required: true,
            choices: [
              { name: "approve", value: "approve" },
              { name: "request changes", value: "request-changes" },
              { name: "comment (read, no verdict)", value: "comment" },
            ],
          },
          {
            type: OptionType.String,
            name: "body",
            description: "what to say; a form opens when omitted",
            max_length: 4000,
          },
          ID_OPTION,
        ],
      },
      {
        type: OptionType.SubCommand,
        name: "assign",
        description: "assign somebody, or yourself",
        options: [
          { type: OptionType.User, name: "user", description: "whom to assign; you when omitted" },
          ID_OPTION,
        ],
      },
      {
        type: OptionType.SubCommand,
        name: "close",
        description: "close an issue",
        options: [
          {
            type: OptionType.String,
            name: "resolution",
            description: "why",
            choices: ["fixed", "wontfix", "duplicate", "invalid"].map((value) => ({
              name: value,
              value,
            })),
          },
          ID_OPTION,
        ],
      },
      {
        type: OptionType.SubCommand,
        name: "reopen",
        description: "reopen an issue",
        options: [ID_OPTION],
      },
      {
        type: OptionType.SubCommand,
        name: "show",
        description: "show an issue or pull request, to you alone",
        options: [ID_OPTION],
      },
      {
        type: OptionType.SubCommand,
        name: "thread",
        description: "give an issue or pull request a thread now",
        options: [{ ...ID_OPTION, required: true, description: "the issue or pull request" }],
      },
    ],
  },
  { name: COMMENT_ON, type: CommandType.Message, contexts: [0] },
];

/** The operations the commands run, checked against the served schema when the bridge starts. */
export const DOCUMENTS = {
  comment: `mutation DiscordComment($input: AddCommentInput!) {
    addComment(input: $input) { comment { id } commit { committed pushed } } }`,
  close: `mutation DiscordClose($input: CloseIssueInput!) {
    closeIssue(input: $input) { commit { committed pushed } } }`,
  reopen: `mutation DiscordReopen($ref: ID!) { reopenIssue(ref: $ref) { commit { committed pushed } } }`,
  issuePeople: `query DiscordIssue($ref: ID!) { issue(ref: $ref) { id assignees baseSha } }`,
  prPeople: `query DiscordPr($ref: ID!) { pr(ref: $ref) { id assignees baseSha } }`,
  assignIssue: `mutation DiscordAssignIssue($input: UpdateIssueInput!) {
    updateIssue(input: $input) { commit { committed pushed } } }`,
  assignPr: `mutation DiscordAssignPr($input: UpdatePrInput!) {
    updatePr(input: $input) { commit { committed pushed } } }`,
} as const;

/** How many interactions are remembered, to answer each once whatever the gateway replays. */
const SEEN_LIMIT = 1_000;

export interface CommandsOptions {
  host: ServerPluginHost;
  bridge: Bridge;
  rest: DiscordRest;
  codes: LinkCodes;
  /** What Discord calls each user the bridge has heard from, for the link page. */
  usernames: Map<string, { username: string; handle: string }>;
  /** Why no linked account may act here, or null when they may. */
  untrusted?: string | null;
}

export class Commands {
  private readonly host: ServerPluginHost;
  private readonly bridge: Bridge;
  private readonly rest: DiscordRest;
  private readonly codes: LinkCodes;
  private readonly usernames: Map<string, { username: string; handle: string }>;
  private readonly untrusted: string | null;
  private readonly seen = new Set<string>();

  constructor(opts: CommandsOptions) {
    this.host = opts.host;
    this.bridge = opts.bridge;
    this.rest = opts.rest;
    this.codes = opts.codes;
    this.usernames = opts.usernames;
    this.untrusted = opts.untrusted ?? null;
  }

  /** Register the commands in the guild, replacing whatever was there. */
  async register(application: string): Promise<void> {
    await this.rest.put(
      `/applications/${application}/guilds/${this.bridge.settings.guild}/commands`,
      COMMANDS,
    );
  }

  /** One interaction, answered once; anything from outside the bridge's guild is ignored. */
  async handle(interaction: Interaction): Promise<void> {
    if (interaction.guild_id !== this.bridge.settings.guild) return;
    if (this.seen.has(interaction.id)) return;
    this.seen.add(interaction.id);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string);
    const user = interaction.member?.user ?? interaction.user;
    if (user === undefined) return;
    this.usernames.set(user.id, {
      username: user.global_name ?? user.username,
      handle: user.username,
    });
    try {
      switch (interaction.type) {
        case InteractionType.Command:
          await this.command(interaction, user);
          return;
        case InteractionType.Autocomplete:
          await this.autocomplete(interaction, user);
          return;
        case InteractionType.Component:
          await this.component(interaction, user);
          return;
        case InteractionType.ModalSubmit:
          await this.submit(interaction, user);
          return;
        default:
          return;
      }
    } catch (error) {
      this.host.report(
        `an interaction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async command(interaction: Interaction, user: User): Promise<void> {
    const data = interaction.data ?? {};
    if (data.type === CommandType.Message && data.name === COMMENT_ON) {
      const actor = this.actor(user);
      if ("refused" in actor) return this.reply(interaction, actor.refused);
      await this.commentOnMessage(interaction);
      return;
    }
    if (data.name !== "nav") return;
    const sub = data.options?.[0];
    if (sub === undefined) return;
    // Asked first, before the record is: an id refused or completed tells
    // whoever reads the refusal that a record is there, and what it is.
    if (!["link", "unlink", "whoami"].includes(sub.name)) {
      const actor = this.actor(user);
      if ("refused" in actor) return this.reply(interaction, actor.refused);
    }
    const option = (name: string): string | undefined => {
      const value = sub.options?.find((each) => each.name === name)?.value;
      return typeof value === "string" ? value : undefined;
    };
    switch (sub.name) {
      case "link":
        await this.link(interaction, user);
        return;
      case "unlink":
        await this.unlink(interaction, user);
        return;
      case "whoami": {
        const email = this.bridge.people.get(user.id);
        await this.reply(
          interaction,
          email === undefined
            ? "Your Discord account is not linked to anybody in the tracker. `/nav link` links it."
            : this.untrusted === null
              ? `Your Discord account acts as ${email}.`
              : `Your Discord account is linked to ${email}. ${this.untrusted}`,
        );
        return;
      }
      case "comment": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        const body = option("body")?.trim();
        if (body === undefined || body === "") {
          return this.modal(
            interaction,
            commentModal(target.record, actionId("m-comment", target.record.id)),
          );
        }
        return this.write(interaction, user, (ctx) => this.comment(ctx, target.record, body));
      }
      case "review": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        if (target.record.kind !== "pr")
          return this.reply(
            interaction,
            `#${target.record.id} is an issue; only a pull request is reviewed.`,
          );
        const verdict = option("verdict") ?? "comment";
        const body = option("body")?.trim();
        if (body === undefined || body === "") {
          return this.modal(interaction, reviewModal(target.record, verdict, undefined));
        }
        return this.write(interaction, user, (ctx) =>
          this.review(ctx, target.record, verdict, body, undefined),
        );
      }
      case "assign": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        const who = option("user") ?? user.id;
        const email = this.bridge.people.get(who);
        if (email === undefined) {
          return this.reply(
            interaction,
            `<@${who}> is not linked to anybody in the tracker, so cannot be assigned from here.`,
          );
        }
        return this.write(interaction, user, (ctx) => this.assign(ctx, target.record, email));
      }
      case "close":
      case "reopen": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        if (target.record.kind !== "issue") {
          return this.reply(
            interaction,
            `#${target.record.id} is a pull request; it is merged or closed from a checkout.`,
          );
        }
        const record = target.record;
        return sub.name === "close"
          ? this.write(interaction, user, (ctx) => this.close(ctx, record, option("resolution")))
          : this.write(interaction, user, (ctx) => this.reopen(ctx, record));
      }
      case "show": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        const view = this.bridge.view;
        if (view === null)
          return this.reply(
            interaction,
            "The tracker has not been read yet; try again in a moment.",
          );
        const body = card(this.bridge.renderContext(view), target.record);
        await this.respond(interaction, InteractionResponseType.ChannelMessage, {
          embeds: body.embeds,
          flags: EPHEMERAL,
          allowed_mentions: { parse: [] },
        });
        return;
      }
      case "thread": {
        const target = this.target(interaction, option("id"));
        if ("refused" in target) return this.reply(interaction, target.refused);
        await this.defer(interaction);
        const opened = await this.bridge
          .openOnRequest(target.record.id)
          .catch((error: unknown) => ({
            refused: error instanceof Error ? error.message : String(error),
          }));
        await this.edit(
          interaction,
          "refused" in opened
            ? `Could not give #${target.record.id} a thread: ${opened.refused}`
            : `${opened.created ? "Started" : "There already is"} a thread for #${target.record.id}: <#${opened.thread.thread}>`,
        );
        return;
      }
      default:
        return;
    }
  }

  private async link(interaction: Interaction, user: User): Promise<void> {
    const url = this.bridge.settings.url;
    if (url === null) {
      await this.reply(
        interaction,
        "This tracker has no web address in its settings, so accounts are linked at a terminal:\n" +
          `\`nav discord link ${user.id} <your address> --commit\`, then push.`,
      );
      return;
    }
    const code = this.codes.mint(user.id, user.global_name ?? user.username, user.username);
    await this.reply(
      interaction,
      `Open ${url}/discord/link?code=${code} within ten minutes, signed in as yourself, to link this Discord account to you. The link works once, and only you can see it.`,
    );
  }

  private async unlink(interaction: Interaction, user: User): Promise<void> {
    const person = this.personOf(user.id);
    if (person === null) {
      await this.reply(interaction, "Your Discord account is not linked to anybody.");
      return;
    }
    // Unlinking only takes away: allowed whether or not the links are trusted.
    await this.act(interaction, user, person, async (ctx) => {
      await writePeople(this.host, ctx, "unlink", person.email, (people) => {
        delete people[user.id];
      });
      return `Unlinked: your Discord account no longer acts as ${person.email}.`;
    });
  }

  private async commentOnMessage(interaction: Interaction): Promise<void> {
    const target = this.target(interaction, undefined);
    if ("refused" in target) {
      await this.reply(
        interaction,
        "Use this on a message in a thread about an issue or pull request.",
      );
      return;
    }
    const data = interaction.data ?? {};
    const message =
      data.target_id === undefined ? undefined : data.resolved?.messages?.[data.target_id];
    const author = message?.author;
    const said = (message?.content ?? "").trim();
    const quoted =
      said === ""
        ? ""
        : said
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
    const attribution =
      author === undefined ? "" : `\n\n— ${author.global_name ?? author.username}, on Discord`;
    await this.modal(
      interaction,
      commentModal(
        target.record,
        actionId("m-comment", target.record.id),
        cut(`${quoted}${attribution}`, 4_000),
      ),
    );
  }

  /** The records an `id` being typed may be, for somebody who may read them. */
  private async autocomplete(interaction: Interaction, user: User): Promise<void> {
    if ("refused" in this.actor(user)) {
      await this.respond(interaction, InteractionResponseType.AutocompleteResult, { choices: [] });
      return;
    }
    const focused = interaction.data?.options?.[0]?.options?.find((option) => option.focused);
    const typed =
      typeof focused?.value === "string"
        ? focused.value.trim().replace(/^#/, "").toLowerCase()
        : "";
    const records = [...(this.bridge.view?.records.values() ?? [])];
    const choices = records
      .filter(
        (record) =>
          typed === "" || record.id.startsWith(typed) || record.title.toLowerCase().includes(typed),
      )
      // Open work first, then the rest; newest first within each.
      .sort((a, b) =>
        a.status === b.status
          ? String(b.fm.created ?? "").localeCompare(String(a.fm.created ?? ""))
          : a.status === "open"
            ? -1
            : b.status === "open"
              ? 1
              : 0,
      )
      .slice(0, 25)
      .map((record) => ({
        name: cut(`#${record.id} ${oneLine(record.title)}`, 100),
        value: record.id,
      }));
    await this.respond(interaction, InteractionResponseType.AutocompleteResult, { choices });
  }

  private async component(interaction: Interaction, user: User): Promise<void> {
    const parsed = parseActionId(interaction.data?.custom_id ?? "");
    if (parsed === null) return;
    const record = this.bridge.view?.records.get(parsed.id);
    if (record === undefined) {
      await this.reply(interaction, `#${parsed.id} is not one the bridge can see now.`);
      return;
    }
    switch (parsed.action) {
      case "approve":
        return this.modal(interaction, reviewModal(record, "approve", parsed.extra));
      case "changes":
        return this.modal(interaction, reviewModal(record, "request-changes", parsed.extra));
      case "comment":
        return this.modal(interaction, commentModal(record, actionId("m-comment", record.id)));
      case "close":
        return this.modal(interaction, closeModal(record));
      case "assign-me": {
        const actor = this.actor(user);
        if ("refused" in actor) return this.reply(interaction, actor.refused);
        return this.write(interaction, user, (ctx) => this.assign(ctx, record, actor.person.email));
      }
      case "reopen":
        return this.write(interaction, user, (ctx) => this.reopen(ctx, record));
      default:
        return;
    }
  }

  private async submit(interaction: Interaction, user: User): Promise<void> {
    const parsed = parseActionId(interaction.data?.custom_id ?? "");
    if (parsed === null) return;
    const values = fieldValues(interaction.data?.components ?? []);
    const body = (values.get("body") ?? "").trim();
    // The answer is deferred by now, so the record may be read afresh if the
    // bridge has not seen it: whether it is an issue decides where it goes.
    const recordOf = async (): Promise<EntityRecord> => {
      const record =
        this.bridge.view?.records.get(parsed.id) ??
        (await this.bridge.readView()).records.get(parsed.id);
      if (record === undefined)
        throw new Error(`#${parsed.id} is not an issue or pull request here`);
      return record;
    };
    switch (parsed.action) {
      case "m-comment":
        return this.write(interaction, user, async (ctx) =>
          this.comment(ctx, await recordOf(), body),
        );
      case "m-approve":
      case "m-changes":
      case "m-reviewed": {
        const verdict =
          parsed.action === "m-approve"
            ? "approve"
            : parsed.action === "m-changes"
              ? "request-changes"
              : "comment";
        return this.write(interaction, user, async (ctx) =>
          this.review(ctx, await recordOf(), verdict, body, parsed.extra),
        );
      }
      case "m-close": {
        const resolution = (values.get("resolution") ?? "").trim();
        return this.write(interaction, user, async (ctx) =>
          this.close(ctx, await recordOf(), resolution === "" ? undefined : resolution),
        );
      }
      default:
        return;
    }
  }

  /** Answer "thinking…", act as the linked person, and say how it went. */
  private async write(
    interaction: Interaction,
    user: User,
    run: (ctx: GraphQLCtx) => Promise<string>,
  ): Promise<void> {
    const actor = this.actor(user);
    if ("refused" in actor) {
      await this.reply(interaction, actor.refused);
      return;
    }
    await this.act(interaction, user, actor.person, run);
  }

  /** {@link write}, for a person already judged. */
  private async act(
    interaction: Interaction,
    user: User,
    person: Identity,
    run: (ctx: GraphQLCtx) => Promise<string>,
  ): Promise<void> {
    await this.defer(interaction);
    let answer: string;
    try {
      answer = await run(this.host.api.contextFor(person));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if ((error as { extensions?: { code?: unknown } }).extensions?.code === "FORBIDDEN") {
        // The server's log says which rule refused them; this says who asked.
        this.host.report(
          `refused to act for ${JSON.stringify(person.email)}, linked to Discord user ${user.id}`,
        );
        answer = `${person.email} is not allowed on this repository, so nothing was done.`;
      } else {
        answer = `That did not work: ${text}`;
      }
    }
    await this.edit(interaction, answer);
  }

  private async comment(
    ctx: GraphQLCtx,
    record: Pick<EntityRecord, "id" | "kind">,
    body: string,
  ): Promise<string> {
    if (body === "") return "Nothing to say: the comment was empty.";
    await this.run(ctx, DOCUMENTS.comment, {
      input: { kind: record.kind === "pr" ? "PR" : "ISSUE", ref: record.id, body },
    });
    return `Commented on #${record.id}.`;
  }

  private async review(
    ctx: GraphQLCtx,
    record: Pick<EntityRecord, "id" | "kind">,
    verdict: string,
    body: string,
    shownHead: string | undefined,
  ): Promise<string> {
    if (body === "") return "Nothing to say: a review needs a few words.";
    // Bound to what the card showed: a revision pushed since is not what was approved.
    let revision: string | undefined;
    if (shownHead !== undefined) {
      const view = await this.bridge.readView();
      const now = view.records.get(record.id);
      const latest = now === undefined ? undefined : this.host.core.latestRevision(now.fm);
      if (latest === undefined || !latest.startsWith(shownHead)) {
        return `#${record.id} has a newer revision than the card you pressed showed; look at it, then review again.`;
      }
      revision = latest;
    }
    await this.run(ctx, DOCUMENTS.comment, {
      input: {
        kind: "PR",
        ref: record.id,
        body,
        verdict:
          verdict === "approve"
            ? "APPROVE"
            : verdict === "request-changes"
              ? "REQUEST_CHANGES"
              : "COMMENT",
        ...(revision === undefined ? {} : { revision }),
      },
    });
    return verdict === "approve"
      ? `Approved #${record.id}.`
      : verdict === "request-changes"
        ? `Requested changes on #${record.id}.`
        : `Reviewed #${record.id}.`;
  }

  private async assign(
    ctx: GraphQLCtx,
    record: Pick<EntityRecord, "id" | "kind">,
    email: string,
  ): Promise<string> {
    const pr = record.kind === "pr";
    const read = await this.run(ctx, pr ? DOCUMENTS.prPeople : DOCUMENTS.issuePeople, {
      ref: record.id,
    });
    const held = (read[pr ? "pr" : "issue"] ?? {}) as { assignees?: string[]; baseSha?: string };
    const assignees = held.assignees ?? [];
    if (
      assignees.some((each) => this.host.core.sameEmail(addressOf(this.host.core, each), email))
    ) {
      return `${email} is already assigned to #${record.id}.`;
    }
    const name = this.bridge.view?.names.get(email.toLowerCase());
    const person = name === undefined ? email : `${name} <${email}>`;
    await this.run(ctx, pr ? DOCUMENTS.assignPr : DOCUMENTS.assignIssue, {
      input: { ref: record.id, assignees: [...assignees, person], baseSha: held.baseSha },
    });
    return `Assigned ${email} to #${record.id}.`;
  }

  private async close(
    ctx: GraphQLCtx,
    record: Pick<EntityRecord, "id">,
    resolution: string | undefined,
  ): Promise<string> {
    await this.run(ctx, DOCUMENTS.close, {
      input: { ref: record.id, ...(resolution === undefined ? {} : { resolution }) },
    });
    return `Closed #${record.id}${resolution === undefined ? "" : ` as ${resolution}`}.`;
  }

  private async reopen(ctx: GraphQLCtx, record: Pick<EntityRecord, "id">): Promise<string> {
    await this.run(ctx, DOCUMENTS.reopen, { ref: record.id });
    return `Reopened #${record.id}.`;
  }

  /** Run an operation, and turn the API's refusal into the error the person reads. */
  private async run(
    ctx: GraphQLCtx,
    document: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.host.api.execute(ctx, document, variables);
    const first = result.errors?.[0];
    if (first !== undefined) throw new Error(first.message);
    return (result.data ?? {}) as Record<string, unknown>;
  }

  /** The person a Discord user acts as here, or what they are told instead. */
  private actor(user: User): { person: Identity } | { refused: string } {
    const person = this.personOf(user.id);
    if (person === null) return { refused: NOT_LINKED };
    if (this.untrusted !== null) return { refused: this.untrusted };
    return { person };
  }

  /** The person a Discord account acts as, with the name the tree knows them by. */
  personOf(user: string): Identity | null {
    const email = this.bridge.people.get(user);
    if (email === undefined) return null;
    const name = this.bridge.view?.names.get(email.toLowerCase());
    return name === undefined ? { email } : { name, email };
  }

  /**
   * The record a command is about: the one named, by id or a prefix of one
   * as everywhere else in the tracker, or else the one whose thread it was
   * typed in.
   */
  private target(
    interaction: Interaction,
    named: string | undefined,
  ): { record: EntityRecord } | { refused: string } {
    const records = this.bridge.view?.records;
    if (records === undefined)
      return { refused: "The tracker has not been read yet; try again in a moment." };
    if (named !== undefined && named.trim() !== "") {
      const prefix = named.trim().replace(/^#/, "");
      const found = this.host.core.resolvePrefix(prefix, [...records.keys()]);
      if (found.ok) return { record: records.get(found.id) as EntityRecord };
      switch (found.reason) {
        case "too-short":
          return {
            refused: `\`${oneLine(named)}\` is too short: give at least ${this.host.core.MIN_PREFIX_LENGTH} characters of an id.`,
          };
        case "not-found":
          return { refused: `Nothing here has an id starting \`${oneLine(prefix)}\`.` };
        default:
          return {
            refused: `\`${oneLine(prefix)}\` could be any of ${found.matches.map((id) => `#${id}`).join(", ")}.`,
          };
      }
    }
    const id = this.bridge.recordOfChannel(interaction.channel_id);
    const record = id === null ? undefined : records.get(id);
    return record === undefined
      ? { refused: "This is not a thread about an issue or pull request: name one with `id:`." }
      : { record };
  }

  private reply(interaction: Interaction, content: string): Promise<void> {
    return this.respond(interaction, InteractionResponseType.ChannelMessage, {
      content: cut(content, 2_000),
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
    });
  }

  private defer(interaction: Interaction): Promise<void> {
    return this.respond(interaction, InteractionResponseType.DeferredChannelMessage, {
      flags: EPHEMERAL,
    });
  }

  private async edit(interaction: Interaction, content: string): Promise<void> {
    await this.rest.patch(
      `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      {
        content: cut(content, 2_000),
        allowed_mentions: { parse: [] },
      },
    );
  }

  private modal(interaction: Interaction, modal: Modal): Promise<void> {
    return this.respond(interaction, InteractionResponseType.Modal, modal);
  }

  private async respond(interaction: Interaction, type: number, data: unknown): Promise<void> {
    await this.rest.post(`/interactions/${interaction.id}/${interaction.token}/callback`, {
      type,
      data,
    });
  }
}

const NOT_LINKED =
  "Your Discord account is not linked to anybody in the tracker, so nothing can be done in your name. `/nav link` links it.";

function commentModal(record: Pick<EntityRecord, "id">, customId: string, value?: string): Modal {
  return {
    custom_id: customId,
    title: `Comment on #${record.id}`,
    components: [textField("body", "Comment", 2, true, value)],
  };
}

function reviewModal(
  record: Pick<EntityRecord, "id">,
  verdict: string,
  head: string | undefined,
): Modal {
  const action =
    verdict === "approve"
      ? "m-approve"
      : verdict === "request-changes"
        ? "m-changes"
        : "m-reviewed";
  const title =
    verdict === "approve"
      ? "Approve"
      : verdict === "request-changes"
        ? "Request changes on"
        : "Review";
  return {
    custom_id: actionId(action, record.id, head),
    title: `${title} #${record.id}`,
    components: [
      textField(
        "body",
        verdict === "request-changes" ? "What needs to change" : "Comment",
        2,
        true,
        verdict === "approve" ? "Approved." : undefined,
      ),
    ],
  };
}

function closeModal(record: Pick<EntityRecord, "id">): Modal {
  return {
    custom_id: actionId("m-close", record.id),
    title: `Close #${record.id}`,
    components: [
      textField("resolution", "Resolution: fixed, wontfix, duplicate, invalid…", 1, false, "fixed"),
    ],
  };
}

function textField(
  id: string,
  label: string,
  style: 1 | 2,
  required: boolean,
  value?: string,
): ModalField {
  return {
    type: 18,
    label: cut(label, 45),
    component: {
      type: 4,
      custom_id: id,
      style,
      required,
      max_length: 4_000,
      ...(value === undefined || value === "" ? {} : { value }),
    },
  };
}

/** The values a submitted modal carries, by field id, however Discord nested them. */
export function fieldValues(components: readonly unknown[]): Map<string, string> {
  const values = new Map<string, string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const each of node) walk(each);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const object = node as Record<string, unknown>;
    if (typeof object.custom_id === "string" && typeof object.value === "string") {
      values.set(object.custom_id, object.value);
    }
    walk(object.component);
    walk(object.components);
  };
  walk(components);
  return values;
}
