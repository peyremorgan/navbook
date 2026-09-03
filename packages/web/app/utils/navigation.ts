/**
 * Where the app is willing to send the browser next.
 *
 * One value here comes back from outside: the `state` handed to the identity
 * provider and returned by it after signing in. It is meant to be the route
 * somebody was heading for when they were interrupted, and it is used to
 * navigate — so it has to be a path within this app and nothing else.
 *
 * A check for a leading slash is not enough. `//example.invalid/` starts with
 * one and is a URL to another host; so, in some parsers, does `/\example.invalid`.
 * Turning an open redirect into a step of a sign-in flow is exactly how a
 * convincing phishing page gets its link.
 */

/** The default when what came back cannot be trusted. */
export const HOME = "/issues";

/**
 * A same-app path, or `HOME`.
 *
 * Accepts a path with its query and fragment; rejects anything that could name
 * another origin, and anything that is not a string at all.
 */
export function safeReturnPath(value: unknown, fallback: string = HOME): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  if (!path.startsWith("/")) return fallback;
  // `//host` and `/\host` are both read as another origin somewhere.
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
  // A control character has no business in a path, and parsers disagree
  // about what to do with one — which is exactly what makes it useful for
  // smuggling a second URL past a check. A space is the same story.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  if (/[\u0000-\u0020\u007f]/.test(path)) return fallback;
  return path;
}
