/**
 * `nav discord <verb>` — `doc/spec.md`, "At a terminal".
 *
 * The `people` map is data in the tree like any other, so a maintainer can
 * edit it from a checkout: link an account somebody cannot link themselves
 * (the tracker has no web address, or they have no sign-in yet), forget one,
 * or see who is linked. Nothing here reaches Discord; the server's bridge
 * reads the map from the served branch once the change is pushed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPluginHost } from "@navbook/cli/plugin";
import { editPeople, MarkerError } from "../core/marker.ts";
import { bareAddress, PLUGIN_NAME, peopleOf, SNOWFLAKE } from "../core/settings.ts";

export function activate(host: CliPluginHost): void {
  const { core, ctx, ui } = host;

  const markerText = (): string | undefined => {
    const path = join(ctx.navRoot, core.NAV_MARKER);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  };

  /** Edit the map, write it, and commit it when asked; say so either way. */
  const save = (
    action: "link" | "unlink",
    email: string,
    commit: boolean,
    edit: (people: Record<string, string>) => void,
  ): boolean => {
    let edited: ReturnType<typeof editPeople>;
    try {
      edited = editPeople(markerText(), edit);
    } catch (error) {
      if (error instanceof MarkerError) {
        ui.fail(error.message, [
          `declare it first: "plugins": { "${PLUGIN_NAME}": { "guild": "<id>" } }`,
        ]);
      }
      throw error;
    }
    if (!edited.changed) return false;
    const run = core.runPlan(
      ctx,
      {
        ops: [{ op: "write", path: core.NAV_MARKER, content: edited.text }],
        message: core.docsScopedSubject("discord", action, email),
        trailers: [],
      },
      { commit },
    );
    if (commit) ctx.stdout.write(`${ui.commitReport(run)}\n`);
    return true;
  };

  host.command("discord link", ([user, email], opts) => {
    if (!SNOWFLAKE.test(user ?? "")) {
      return ui.fail(`${JSON.stringify(user ?? "")} is not a Discord user id`, [
        "copy it in Discord with Developer Mode on: right-click the person, Copy User ID",
      ]);
    }
    const address = bareAddress(email ?? "", core);
    if (address === null) {
      return ui.fail(`${JSON.stringify(email ?? "")} is not an email address`, [
        "give the bare address the tracker records the person by, e.g. alice@example.com",
      ]);
    }
    const id = user as string;
    const changed = save("link", address, opts.commit === true, (people) => {
      people[id] = address;
    });
    ctx.stdout.write(
      changed
        ? `Linked Discord user ${id} to ${address}\n`
        : `Discord user ${id} is already linked to ${address}\n`,
    );
  });

  host.command("discord unlink", ([key], opts) => {
    const wanted = (key ?? "").trim();
    const people = linked();
    if (SNOWFLAKE.test(wanted)) {
      const email = people.get(wanted);
      if (email === undefined) return ui.fail(`Discord user ${wanted} is not linked`);
      save("unlink", email, opts.commit === true, (map) => {
        delete map[wanted];
      });
      ctx.stdout.write(`Unlinked Discord user ${wanted} from ${email}\n`);
      return;
    }
    const address = bareAddress(wanted, core);
    if (address === null) {
      return ui.fail(`${JSON.stringify(wanted)} is neither a Discord user id nor an email address`);
    }
    const users = [...people]
      .filter(([, email]) => core.sameEmail(email, address))
      .map(([id]) => id);
    if (users.length === 0) return ui.fail(`no Discord account is linked to ${address}`);
    save("unlink", address, opts.commit === true, (map) => {
      for (const id of users) delete map[id];
    });
    ctx.stdout.write(
      `Unlinked ${users.map((id) => `Discord user ${id}`).join(", ")} from ${address}\n`,
    );
  });

  host.command("discord people", (_args, opts) => {
    const people = linked();
    if (opts.json === true) {
      const objects = [...people].map(([discordUserId, email]) => ({ discordUserId, email }));
      if (objects.length > 0) ctx.stdout.write(`${core.toNdjson(objects)}\n`);
      return;
    }
    if (people.size === 0) {
      ctx.stdout.write("No Discord accounts are linked.\n");
      return;
    }
    ctx.stdout.write(
      `${ui.renderTable(
        [{ header: "discord user" }, { header: "email", flexible: true }],
        [...people].map(([id, email]) => [id, email]),
      )}\n`,
    );
  });

  /** The map as the working tree has it; entries that do not read are left out. */
  function linked(): Map<string, string> {
    const settings = core.readPluginDeclaration(ctx).plugins.get(PLUGIN_NAME);
    return peopleOf(settings, core).people;
  }
}
