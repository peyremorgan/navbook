/**
 * The server probe's API half.
 *
 * It does the three things only a server plugin can: extends the schema,
 * registers something long-running, and subscribes to mutations. The service
 * connects to nothing — what is being tested is that it is started before the
 * port opens and stopped before the clone is released.
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
    },
    async stop() {
      log("service:stop");
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
