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

  host.service({
    name: "srvprobe",
    async start() {
      log("service:start");
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
    },
  });
}
