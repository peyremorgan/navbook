/**
 * The server probe's API half.
 *
 * It does the things only a server plugin can: extends the schema, registers
 * something long-running, subscribes to mutations and to pulls, and acts for a
 * person with no request in flight. The service connects to nothing — what is
 * being tested is that it is started before the port opens and stopped before
 * the clone is released, and what it is told and allowed meanwhile.
 *
 * `SRVPROBE_ACT_AS` (`Name <address>`, or an address) has the service open an
 * issue as that person when it starts. `SRVPROBE_SYNC_READ` has it read the
 * issue titles, as the server itself, whenever it is told of a sync.
 * `SRVPROBE_LATE_READ` has it hold the clone a moment as it stops, and ask
 * for a read meanwhile, as a service shutdown went on without would.
 */

import { appendFileSync } from "node:fs";

/** Every commit subject this process has been told about. */
const seen = [];

function log(line) {
  if (process.env.SRVPROBE_LOG) appendFileSync(process.env.SRVPROBE_LOG, `${line}\n`);
}

export function activate(host) {
  const token = host.pluginConfig.NAV_SERVER_SRVPROBE_TOKEN;
  const note = host.pluginConfig.NAV_SERVER_SRVPROBE_NOTE ?? null;
  log(`activate token=${token}`);

  host.onMutation((event) => {
    seen.push(event.subject);
    log(`mutation ${event.subject} pushed=${event.pushed} by=${event.viewer.email}`);
  });

  // What somebody else pushed reaches no mutation listener; this hears of it.
  host.onSync(async (event) => {
    if (!process.env.SRVPROBE_SYNC_READ) {
      log(`sync ${event.cause}`);
      return;
    }
    // Nobody to act for: read as the server itself.
    const ctx = host.api.contextFor();
    const result = await host.api.execute(
      ctx,
      "{ issues(filter: { status: [OPEN, CLOSED] }) { title } }",
    );
    const titles = result.data.issues.map((issue) => issue.title).sort();
    log(`sync ${event.cause} titles=${titles.join("|")}`);
  });

  // The schema is built from every plugin's SDL, so it cannot exist yet.
  try {
    host.api.schema();
    log("schema during activate: available");
  } catch {
    log("schema during activate: unavailable");
  }

  host.service({
    name: "srvprobe",
    async start() {
      log("service:start");
      log(
        `schema at start: ${host.api.schema().getQueryType()?.getFields().srvprobe ? "has srvprobe" : "lacks srvprobe"}`,
      );
      if (process.env.SRVPROBE_ACT_AS) await actAs(host, process.env.SRVPROBE_ACT_AS);
    },
    async stop() {
      log("service:stop");
      if (process.env.SRVPROBE_LATE_READ) lateRead(host);
    },
  });

  // What this plugin has to say about an entity, on the host's own fragments.
  host.entityExt((entity) => ({
    tags: host.core.readStringOrList(entity.fm, "srvprobe-tag"),
  }));

  host.resolvers({
    Query: {
      srvprobe: () => ({ note }),
      srvprobeWriteTarget: (_parent, { ref }, ctx) =>
        host.api.run(() => ctx.sync.read(() => host.api.writeTarget(ctx, "pr", ref).id)),
    },
    SrvProbe: {
      seen: () => [...seen],
      // Read through the context every built-in resolver uses, so the tree a
      // plugin sees is the tree the API just wrote.
      tags: async (_parent, _args, ctx) => {
        const repo = await ctx.repo();
        const tags = new Set();
        for (const entity of host.core.allEntities(repo)) {
          for (const tag of host.core.readStringOrList(entity.fm, "srvprobe-tag")) tags.add(tag);
        }
        return [...tags].sort();
      },
      issueTitles: async (_parent, _args, ctx) => {
        const result = await host.api.execute(
          ctx,
          "query { issues(filter: { status: [OPEN, CLOSED] }) { title } }",
        );
        return result.data.issues.map((issue) => issue.title).sort();
      },
      // The deadlock `execute` refuses: an operation queued behind the read
      // that is waiting for it.
      underLock: async (_parent, _args, ctx) => {
        try {
          await ctx.sync.read(() => host.api.execute(ctx, "{ issues { title } }"));
          return "ran";
        } catch (error) {
          return error.message;
        }
      },
      invalid: async (_parent, _args, ctx) => {
        const result = await host.api.execute(ctx, "query { nothingLikeThis }");
        return result.errors.map((error) => error.message);
      },
    },
    Mutation: {
      srvprobeNote: (_parent, { kind, ref, text }, ctx) =>
        host.api.run(async () => {
          const core = host.core;
          const { result, pushed } = await host.api.writeEntity(
            ctx,
            kind === "PR" ? "pr" : "issue",
            ref,
            (at, entity, site) => {
              const content = core.newCommentFile({ author: core.currentAuthor(at), body: text });
              const added = core.applyComment(at, entity, { content }, { commit: true });
              return { run: added.run, branch: site.worktree === null ? null : site.branch };
            },
          );
          // The write itself tells nobody: reporting it is what emits the event.
          const info = host.api.commitInfo(ctx, result.run, pushed);
          return { subject: info.subject, pushed: info.pushed, branch: result.branch };
        }),
    },
  });
}

/**
 * Hold the clone for a while, and ask for a read halfway through.
 *
 * The hold is queued while the service is still stopping, so shutdown waits
 * for it; the read is asked for after, when the server has had every chance
 * to close the clone to newcomers.
 */
function lateRead(host) {
  void host.sync.locked(() => new Promise((resolve) => setTimeout(resolve, 200)));
  setTimeout(() => {
    host.sync
      .read(() => undefined)
      .then(
        () => log("late read ran"),
        (error) => log(`late read refused ${error.extensions?.code ?? "?"}`),
      );
  }, 50);
}

/** Open an issue as `who` from the service, and log what came of it. */
async function actAs(host, who) {
  const person = host.core.parsePerson(who) ?? { email: who };
  let ctx;
  try {
    ctx = host.api.contextFor(person);
  } catch (error) {
    log(`refused ${error.extensions?.code ?? "?"}: ${error.message}`);
    return;
  }
  const result = await host.api.execute(
    ctx,
    `mutation { openIssue(input: { title: "Opened by a service", body: "Body." }) {
      issue { author } commit { subject pushed } } }`,
  );
  if (result.errors?.length) {
    log(`failed ${result.errors.map((error) => error.message).join("; ")}`);
    return;
  }
  const { issue, commit } = result.data.openIssue;
  log(`acted ${commit.subject} pushed=${commit.pushed} author=${issue.author}`);
}
