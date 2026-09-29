// Preloaded with `--import` into a `nav` under test: logs every module of this
// plugin that gets resolved, to $CHAT_IMPORT_LOG, so a test can prove a
// command that does not use the plugin never loads any of it.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

const log = process.env.CHAT_IMPORT_LOG;
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (log && resolved.url.includes("/plugin-chat/src/")) appendFileSync(log, `${resolved.url}\n`);
    return resolved;
  },
});
