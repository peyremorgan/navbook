/**
 * The server half of `@navbook/plugin-discord`: the bridge, as a service of
 * the server that owns the clone (spec 06 §6.2), and the schema the web
 * tracker links accounts through.
 *
 * Without a token there is no bridge — said once in the log — and the schema
 * says so (`Query.discord` is null), so a client built with this plugin's
 * layer shows nothing to a server that runs none. With a token, settings that
 * do not read stop the server: a bridge was asked for, and one that silently
 * did nothing would be found out much later.
 */

import { join } from "node:path";
import type { Identity } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { bareAddress, PLUGIN_NAME, peopleOf, SNOWFLAKE, serverSettings } from "../core/settings.ts";
import { Bridge } from "./bridge.ts";
import { Commands } from "./commands.ts";
import { DiscordGateway } from "./discord/gateway.ts";
import { DiscordRest } from "./discord/rest.ts";
import { type Channel, INTENT_GUILDS, type Interaction, type Ready } from "./discord/types.ts";
import { LinkCodes, writePeople } from "./link.ts";
import { StateFile } from "./state.ts";

const TOKEN = "NAV_SERVER_DISCORD_TOKEN";
const GUILD = "NAV_SERVER_DISCORD_GUILD";
const API_URL = "NAV_SERVER_DISCORD_API_URL";
const TRUST_LINKS = "NAV_SERVER_DISCORD_TRUST_LINKS";

export function activate(host: ServerPluginHost): void {
  const { core } = host;
  const codes = new LinkCodes();
  const usernames = new Map<string, { username: string; handle: string }>();
  const bridge = startBridge(host, codes, usernames);
  /** A link as the schema spells it, with what Discord calls the account if the bridge knows. */
  const linkFor = (user: string) => ({
    userId: user,
    username: usernames.get(user)?.username ?? null,
    handle: usernames.get(user)?.handle ?? null,
  });

  host.entityExt((entity) => ({ thread: bridge?.threadUrl(entity.id) ?? null }));

  const notRunning = (): Error =>
    host.api.apiError("this server runs no Discord bridge", "PRECONDITION");

  /** Every account linked to `email` in the served branch's settings. */
  const linksOf = async (ctx: GraphQLCtx, email: string) => {
    const settings = await ctx.sync.read(() =>
      core.readPluginDeclaration(ctx.ws).plugins.get(PLUGIN_NAME),
    );
    return [...peopleOf(settings, core).people]
      .filter(([, linked]) => core.sameEmail(linked, email))
      .map(([user]) => linkFor(user));
  };

  host.resolvers({
    Query: {
      discord: () => (bridge === null ? null : { guild: bridge.settings.guild }),
    },
    DiscordBridge: {
      thread: (_parent: unknown, args: { ref: string }) => {
        if (bridge === null) return null;
        const id = bridge.threaded(args.ref.trim().replace(/^#/, ""));
        const url = id === null ? null : bridge.threadUrl(id);
        return id === null || url === null ? null : { id: bridge.threadOf(id)?.thread, url };
      },
      pending: (_parent: unknown, args: { code: string }) => {
        const pending = codes.peek(args.code);
        return pending === null
          ? null
          : { userId: pending.user, username: pending.username, handle: pending.handle };
      },
    },
    Viewer: {
      discord: (viewer: Identity, _args: unknown, ctx: GraphQLCtx) =>
        host.api.run(() => linksOf(ctx, viewer.email)),
    },
    Mutation: {
      linkDiscord: (_parent: unknown, args: { code: string }, ctx: GraphQLCtx) =>
        host.api.run(async () => {
          if (bridge === null) throw notRunning();
          // Checked as the settings read a link, before the code is spent:
          // one the bridge would refuse is not committed for it to refuse.
          const email = bareAddress(ctx.viewer.email, core);
          if (email === null) {
            throw host.api.invalidInput(
              `${JSON.stringify(ctx.viewer.email)} is not an address navbook.json can link a Discord account to`,
            );
          }
          // Taken before the write, so two redemptions racing cannot both
          // link; put back if the write fails, so it can be tried again.
          const pending = codes.take(args.code);
          if (pending === null) {
            throw host.api.invalidInput(
              "this link code is unknown or has expired; run /nav link in Discord for a new one",
            );
          }
          let written: Awaited<ReturnType<typeof writePeople>>;
          try {
            written = await writePeople(host, ctx, "link", email, (people) => {
              people[pending.user] = email;
            });
          } catch (error) {
            codes.restore(args.code, pending);
            throw error;
          }
          usernames.set(pending.user, { username: pending.username, handle: pending.handle });
          return {
            link: linkFor(pending.user),
            commit: host.api.commitInfo(ctx, written.run, written.pushed),
          };
        }),
      unlinkDiscord: (_parent: unknown, _args: unknown, ctx: GraphQLCtx) =>
        host.api.run(async () => {
          const email = ctx.viewer.email;
          const { run, pushed } = await writePeople(host, ctx, "unlink", email, (people) => {
            for (const [user, linked] of Object.entries(people)) {
              if (core.sameEmail(linked, email)) delete people[user];
            }
          });
          return { link: null, commit: host.api.commitInfo(ctx, run, pushed) };
        }),
    },
  });
}

/** The bridge, if a token asks for one: its client, its gateway, its service. */
function startBridge(
  host: ServerPluginHost,
  codes: LinkCodes,
  usernames: Map<string, { username: string; handle: string }>,
): Bridge | null {
  const token = host.pluginConfig[TOKEN];
  if (token === undefined) {
    host.report(`bridge not offered: ${TOKEN} is not set`);
    return null;
  }
  const reading = serverSettings(host.settings, host.core);
  if (!reading.ok) {
    throw new Error(
      `${PLUGIN_NAME} has a token but its settings in navbook.json do not read: ${reading.problems.join("; ")}`,
    );
  }
  // A link that does not read is dropped, not fatal: the bridge's first run
  // reads the settings again and says which.
  const pinned = host.pluginConfig[GUILD];
  if (pinned !== undefined) {
    if (!SNOWFLAKE.test(pinned))
      throw new Error(`${GUILD} is not a Discord id: ${JSON.stringify(pinned)}`);
    // The settings are committed, and anybody who can commit can change
    // them: a guild the deployment did not choose is never served.
    if (pinned !== reading.settings.guild) {
      throw new Error(
        `navbook.json names guild ${reading.settings.guild}, and ${GUILD} allows only ${pinned}`,
      );
    }
  }

  const stopper = new AbortController();
  const rest = new DiscordRest({
    token,
    ...(host.pluginConfig[API_URL] === undefined ? {} : { apiUrl: host.pluginConfig[API_URL] }),
    signal: stopper.signal,
  });
  const gitDir = host.core
    .git(["rev-parse", "--absolute-git-dir"], { cwd: host.config.repoPath })
    .trim();
  const bridge = new Bridge({
    host,
    settings: reading.settings,
    rest,
    state: new StateFile(join(gitDir, "navbook", "discord.json"), host.report),
  });
  const commands = new Commands({
    host,
    bridge,
    rest,
    codes,
    usernames,
    untrusted: untrustedLinks(host),
  });
  const gateway = new DiscordGateway({
    rest,
    token,
    intents: INTENT_GUILDS,
    report: host.report,
    onDispatch: (event, data) => {
      switch (event) {
        case "READY":
          void bridge.checkChannels();
          commands
            .register((data as Ready).application.id)
            .then(() =>
              host.report(
                `connected to Discord; commands registered in guild ${bridge.settings.guild}`,
              ),
            )
            .catch((error: unknown) =>
              host.report(
                `could not register the commands: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          return;
        case "INTERACTION_CREATE":
          void commands.handle(data as Interaction);
          return;
        case "THREAD_DELETE":
          bridge.forget((data as { id: string }).id);
          return;
        case "THREAD_UPDATE":
          bridge.noteThread(data as Channel);
          return;
        default:
          return;
      }
    },
  });

  host.onSync(() => bridge.notify());
  host.service({
    name: "discord",
    async start() {
      // Checked here, where the schema exists: an operation the server no
      // longer answers is a startup fault, not a command that fails later.
      const schema = host.api.schema();
      const missing = [
        ["addComment", "closeIssue", "reopenIssue", "updateIssue", "updatePr"].filter(
          (field) => schema.getMutationType()?.getFields()[field] === undefined,
        ),
        ["issue", "pr"].filter((field) => schema.getQueryType()?.getFields()[field] === undefined),
      ].flat();
      if (missing.length > 0) {
        throw new Error(`the served schema lacks ${missing.join(", ")}, which the bridge runs`);
      }
      bridge.notify();
      gateway.start();
    },
    async stop() {
      stopper.abort(new Error("the server is stopping"));
      // Side by side: the bridge's state is saved whatever the gateway does.
      await Promise.allSettled([gateway.stop(), bridge.stop()]);
    },
  });
  return bridge;
}

/**
 * Why no linked Discord account may act on this server, or null when they
 * may — said once in the log either way, when it is a choice.
 *
 * A link vouches for an address, and `host.api.contextFor` applies the one
 * admission rule an address answers. The rules that read a token — a claim,
 * a verified address — cannot be asked of somebody acting from Discord: so
 * a person a server admits by their group would keep acting from Discord
 * after the group dropped them. Where such rules are in force, the operator
 * says whether the links will do in their place.
 */
function untrustedLinks(host: ServerPluginHost): string | null {
  const { policy } = host.config;
  const rules = [
    ...(policy.requireClaims.length > 0 ? ["--require-claim"] : []),
    ...(policy.requireEmailVerified ? ["--require-email-verified"] : []),
  ];
  const given = host.pluginConfig[TRUST_LINKS]?.trim().toLowerCase();
  if (given !== undefined && !["true", "false", "yes", "no", "1", "0"].includes(given)) {
    throw new Error(`${TRUST_LINKS} takes true or false, got ${JSON.stringify(given)}`);
  }
  if (rules.length === 0) return null;
  const which = rules.join(" and ");
  if (given === "true" || given === "yes" || given === "1") {
    host.report(
      `linked Discord accounts act without ${which}, which no Discord account carries, as ${TRUST_LINKS} allows; ` +
        "unlink a person who loses access (nav discord unlink)",
    );
    return null;
  }
  host.report(
    `linked Discord accounts act for nobody: this server admits people by ${which}, which Discord cannot show; ` +
      `set ${TRUST_LINKS}=true to let the links stand in for them`,
  );
  return "This server admits people by what their sign-in says, which Discord cannot show it, so nothing is done or shown here in anybody's name. Use the web tracker.";
}
