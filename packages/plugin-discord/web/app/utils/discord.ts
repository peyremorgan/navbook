/**
 * The Discord bridge's slice of `Entity.ext`, read defensively.
 *
 * `ext` is a JSON scalar every loaded plugin fills under its short name, so a
 * client built with this layer against a server without the plugin gets no
 * key at all — and a server with it but no bridge gets `{ thread: null }`.
 * Both read as "no thread". Only a link into Discord is accepted, so nothing
 * else the server could be made to say becomes a link on somebody's page.
 */

const THREAD_URL = /^https:\/\/discord\.com\/channels\/\d+\/\d+$/;

export function readDiscordThread(ext: unknown): string | null {
  if (typeof ext !== "object" || ext === null) return null;
  const slice = (ext as Record<string, unknown>).discord;
  if (typeof slice !== "object" || slice === null) return null;
  const thread = (slice as Record<string, unknown>).thread;
  return typeof thread === "string" && THREAD_URL.test(thread) ? thread : null;
}
