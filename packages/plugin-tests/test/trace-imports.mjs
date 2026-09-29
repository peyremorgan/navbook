// Preloaded with `node --import` by the loading suite: records every module
// of this plugin's sources that the process resolves, into $TRACE_LOG. An
// empty log is proof that a command imported none of it.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (process.env.TRACE_LOG && result.url.includes("/plugin-tests/src/")) {
      appendFileSync(process.env.TRACE_LOG, `${result.url.replace(/^.*\/plugin-tests\//, "")}\n`);
    }
    return result;
  },
});
