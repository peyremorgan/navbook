/**
 * What the web layer reads out of `Entity.ext`: a link to Discord, or nothing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readDiscordThread } from "../web/app/utils/discord.ts";

const URL = "https://discord.com/channels/100000000000000001/200000000000000000";

describe("readDiscordThread", () => {
  it("reads the bridge's thread link", () => {
    assert.equal(readDiscordThread({ discord: { thread: URL } }), URL);
  });

  it("reads nothing where a server says nothing, or something else", () => {
    for (const ext of [
      undefined,
      null,
      {},
      { discord: null },
      { discord: { thread: null } },
      { discord: { thread: 7 } },
      { discord: "x" },
      { discord: { thread: "https://evil.example/channels/1/2" } },
      { discord: { thread: "javascript:alert(1)" } },
      { discord: { thread: `${URL}/extra` } },
    ]) {
      assert.equal(readDiscordThread(ext), null, JSON.stringify(ext));
    }
  });
});
