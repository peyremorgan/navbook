/**
 * What a plugin says about itself, and what a repository says it uses —
 * spec 02 §2.12 and spec 04 §4.3.
 *
 * Two different documents are parsed here, and keeping them in one file is
 * deliberate: they are the two halves of one handshake. A plugin's manifest
 * says what it contributes; a repository's declaration names the plugins its
 * tree was written by. Neither loads anything. Everything below is a pure
 * function over text somebody else read, which is what lets the manifest be
 * checked against a registry entry before a byte of the package is fetched.
 *
 * The manifest is the load-bearing idea. A host builds its command tree, its
 * help and its completions from these fields alone and imports a plugin's code
 * only when one of the things it declared actually runs (spec 04 §4.3). That
 * is why the shapes here are so explicit: every option, argument and query key
 * a plugin adds has to be describable as data, or the host would have to run
 * the plugin to find out what it does — which is the cost the startup budget
 * cannot pay (spec 05 §5.2).
 */

/**
 * The plugin API version this implementation provides.
 *
 * A plugin declares the range it was built against in `engines.navbook`, and a
 * host that does not satisfy it says so and skips the plugin. The alternative
 * is discovering the mismatch as a missing function somewhere inside an
 * operation, by which point the user is reading a stack trace about a tree
 * that is perfectly sound.
 *
 * It moves with the *surface* — the manifest shape, the host objects, the
 * extension registries — and not with the package version, because those are
 * different promises: `@navbook/core` may release for a format change that
 * costs a plugin nothing.
 */
export const PLUGIN_API_VERSION = "1.1.0";

/** The keyword a package must carry to be installable as a plugin (spec 04 §4.3). */
export const PLUGIN_KEYWORD = "navbook-plugin";

/**
 * A plugin's short name: what its namespaces are named after.
 *
 * One word, so that `X-kb-1`, `NAV_SERVER_KB_TOKEN` and `.navbook/kb/` are all
 * unambiguous decompositions. The grammar is the slug grammar without hyphens,
 * for the same reason the slug grammar exists: these names end up in paths,
 * environment variables and diagnostic codes, and a character that is special
 * in any of those is a character that will eventually be one.
 */
export const PLUGIN_SHORT_PATTERN = /^[a-z][a-z0-9]*$/;

/** Kinds a contribution may apply to; mirrors `EntityKind` without importing it. */
export type PluginEntityKind = "issue" | "pr";

/** A query term a plugin adds to the grammar of spec 04 §4.3. */
export interface QueryKeySpec {
  /** The term's key, written without the colon. */
  key: string;
  kinds: PluginEntityKind[];
  /** One line for `--help`, in the shape the built-in terms use. */
  help: string;
  /**
   * True when matching needs comment bodies loaded.
   *
   * A listing reads comments only when the query needs them, because reading
   * every comment in a repository to answer a question about titles is the
   * difference between the budget and twice it.
   */
  needsComments?: boolean;
}

/** A check a plugin adds to `nav doctor`, numbered `X-<short>-<n>` (spec 04 §4.3). */
export interface DoctorCheckSpec {
  id: string;
  level: "error" | "warning";
  description: string;
}

/** An option a plugin adds to a command of its own or to a built-in verb. */
export interface OptionSpec {
  /**
   * The flag as Commander spells it: `--feature <slug>`.
   *
   * Long flags only. A plugin cannot take `-m` or `-y`, because short flags
   * are a scarce shared namespace and the collision would be discovered by
   * whoever installed two plugins rather than by whoever wrote the second.
   */
  flags: string;
  description: string;
  /** Repeatable options collect into an array, as `--label` does. */
  repeatable?: boolean;
  /** How to read the value; the default is to leave it a string. */
  parse?: "int" | "number";
  default?: unknown;
}

/** A positional argument of a plugin's command. */
export interface ArgumentSpec {
  name: string;
  description?: string;
  /** Optional arguments render as `[name]`; the default is required, `<name>`. */
  optional?: boolean;
  /** A variadic argument takes the rest, and must come last. */
  variadic?: boolean;
  /** Names a completer the plugin's CLI entry registers, for shell completion. */
  complete?: string;
}

/** A command a plugin adds. Nouns sit at the root; `commands` nests verbs under them. */
export interface CommandSpec {
  name: string;
  description: string;
  arguments?: ArgumentSpec[];
  options?: OptionSpec[];
  commands?: CommandSpec[];
  /**
   * True when running this command needs the format extensions loaded.
   *
   * Most do — a command that reads the tree needs whatever teaches the tree
   * about the plugin's files. It is declared rather than assumed so that a
   * command which only prints something need not pay for it.
   */
  needsCore?: boolean;
}

/** What a plugin adds to a command that already exists. */
export interface VerbContribution {
  /** The command, as typed: `issue open`, `pr list`, `issue show`. */
  on: string;
  options?: OptionSpec[];
  /** The plugin adds a column to this listing. */
  columns?: boolean;
  /** The plugin adds a section to this `show`. */
  showSection?: boolean;
  /** The plugin adds keys to this command's `--json`. */
  jsonExtra?: boolean;
  /** The plugin offers completion candidates for this command's arguments. */
  completions?: boolean;
}

/** An environment variable a plugin's server part reads. */
export interface ServerConfigSpec {
  /** The full variable name, which must be `NAV_SERVER_<SHORT>_*`. */
  env: string;
  description: string;
  /** A required key absent at startup stops the server, as its own do. */
  required?: boolean;
}

/** The namespaces a plugin's data occupies (spec 02 §2.12). */
export interface FormatDeclaration {
  /** Top-level directories inside the Navbook root, e.g. `["specs"]`. */
  root?: string[];
  /** Names claimed inside an entity directory, as `<name>/` or `<name>.*`. */
  entityDirs?: string[];
  /** Frontmatter keys claimed, each `<short>-*` unless grandfathered. */
  frontmatterKeys?: string[];
  /**
   * Set only by a plugin implementing something this specification defines.
   *
   * It lifts the `<short>`-prefix requirement for exactly the one name pair
   * the format grandfathers — `specs/` and `feature:`, which §2.12 lists —
   * and nothing else: a plugin setting it claims to be that plugin, and may
   * still claim no other name outside its own namespace.
   */
  grandfathered?: boolean;
}

/** The names §2.12 grandfathers, by the format key that claims them. */
const GRANDFATHERED: Record<"root" | "entityDirs" | "frontmatterKeys", readonly string[]> = {
  root: ["specs"],
  entityDirs: [],
  frontmatterKeys: ["feature"],
};

/** The `navbook` key of a plugin's `package.json`. */
export interface PluginManifest {
  short: string;
  /** Package-relative path to the plugin's own specification; required with `format`. */
  spec?: string;
  format?: FormatDeclaration;
  core?: {
    queryKeys?: QueryKeySpec[];
    doctorChecks?: DoctorCheckSpec[];
    commitScopes?: string[];
  };
  cli?: {
    commands?: CommandSpec[];
    contributions?: VerbContribution[];
  };
  server?: {
    /** Package-relative path to the SDL merged into the schema. */
    schema?: string;
    config?: ServerConfigSpec[];
    /** True when the plugin registers long-running services (spec 06 §6.2). */
    services?: boolean;
  };
  /** True when `./web` is a Nuxt layer to merge at build time. */
  web?: boolean;
}

/** A package read as a plugin: what it is, and what it says it contributes. */
export interface PluginPackage {
  name: string;
  version: string;
  manifest: PluginManifest;
  /** The `engines.navbook` range, or null when the plugin names none. */
  engines: string | null;
}

/** Either a plugin package or the reason the text could not be read as one. */
export type PluginPackageReading =
  | { ok: true; plugin: PluginPackage }
  | { ok: false; error: string };

/** A plain JSON object — not an array, and not `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * True when a package name is spelled as a plugin's (spec 04 §4.3).
 *
 * Checked before a package is installed, together with the keyword. Either
 * alone would be too weak: a name is chosen by whoever publishes and says
 * nothing about intent, and a keyword can be added to anything. Together they
 * are a deliberate act, which is all this needs to be — it is a guard against
 * installing the wrong thing by accident, not against a hostile publisher, who
 * would simply satisfy both.
 */
export function isPluginPackageName(name: string): boolean {
  // The whole of npm's name grammar, not just the prefix: the server resolves
  // a declared name through `node_modules`, and `navbook-plugin-x/../../srv`
  // would otherwise pass as a name and resolve as a path.
  if (name.length > 214) return false;
  if (name.startsWith("@")) {
    const parts = name.slice(1).split("/");
    if (parts.length !== 2) return false;
    const [scope = "", rest = ""] = parts;
    if (!NPM_NAME_PART.test(scope) || !NPM_NAME_PART.test(rest)) return false;
    if (scope === "navbook") return rest.startsWith("plugin-") && rest.length > "plugin-".length;
    return rest.startsWith("navbook-plugin-") && rest.length > "navbook-plugin-".length;
  }
  if (!NPM_NAME_PART.test(name)) return false;
  return name.startsWith("navbook-plugin-") && name.length > "navbook-plugin-".length;
}

/** One segment of an npm package name: lowercase, URL-safe, never a dot-name. */
const NPM_NAME_PART = /^[a-z0-9~-][a-z0-9._~-]*$/;

/**
 * The package names a short name could mean, in the order to try them.
 *
 * `nav plugin install kb` is a convenience, and the convenience is allowed to
 * guess only in this order: a first-party plugin, then a third-party one. What
 * gets recorded is always the full name that resolved, so the guess happens
 * once and never again.
 */
export function expandPluginName(name: string): string[] {
  if (name.includes("/") || name.startsWith("@") || isPluginPackageName(name)) return [name];
  return [`@navbook/plugin-${name}`, `navbook-plugin-${name}`];
}

/**
 * Read a plugin's `package.json` into what a host needs to know.
 *
 * Faults are returned rather than thrown, and the first one stops the read: a
 * manifest is either usable or it is not, unlike a review policy, where each
 * key falls back on its own because the tree is still readable without it. A
 * plugin whose manifest is half-parsed would contribute half a command tree.
 */
export function parsePluginPackage(pkg: unknown): PluginPackageReading {
  const bad = (error: string): PluginPackageReading => ({ ok: false, error });

  if (!isPlainObject(pkg)) return bad("package.json is not a JSON object");
  const { name, version } = pkg;
  if (typeof name !== "string" || name === "") return bad("package.json has no name");
  if (typeof version !== "string" || version === "") return bad("package.json has no version");

  const raw = pkg.navbook;
  if (raw === undefined) return bad(`${name} has no 'navbook' key; it is not a plugin`);
  if (!isPlainObject(raw)) return bad(`${name}: 'navbook' must be an object`);

  const short = raw.short;
  if (typeof short !== "string" || !PLUGIN_SHORT_PATTERN.test(short)) {
    return bad(`${name}: 'navbook.short' must match ${PLUGIN_SHORT_PATTERN.source}`);
  }

  const manifest: PluginManifest = { short };

  if (raw.spec !== undefined) {
    if (typeof raw.spec !== "string" || raw.spec === "") {
      return bad(`${name}: 'navbook.spec' must be a path`);
    }
    manifest.spec = raw.spec;
  }

  if (raw.format !== undefined) {
    if (!isPlainObject(raw.format)) return bad(`${name}: 'navbook.format' must be an object`);
    const format: FormatDeclaration = {};
    const grandfathered = raw.format.grandfathered === true;
    if (grandfathered) format.grandfathered = true;

    for (const key of ["root", "entityDirs", "frontmatterKeys"] as const) {
      const value = raw.format[key];
      if (value === undefined) continue;
      if (!isStringArray(value)) return bad(`${name}: 'navbook.format.${key}' must be strings`);
      // The namespace rule of §2.12, enforced where it can still be reported
      // against a name rather than discovered as a silently ignored directory.
      // Grandfathering lifts it for the one pair §2.12 lists and nothing else:
      // a plugin setting the flag may claim `specs/` and `feature:` besides its
      // own names, never any other name outside them.
      const exempt = grandfathered ? GRANDFATHERED[key] : [];
      const wrong = value.find(
        (entry) => !exempt.includes(entry) && !ownsName(short, entry, key === "frontmatterKeys"),
      );
      if (wrong !== undefined) {
        return bad(
          `${name}: 'navbook.format.${key}' entry '${wrong}' is outside the '${short}' namespace`,
        );
      }
      format[key] = value;
    }
    // §2.12: data nobody can look up is data nobody can keep.
    if (manifest.spec === undefined) {
      return bad(`${name}: 'navbook.format' requires 'navbook.spec' naming its specification`);
    }
    manifest.format = format;
  }

  // The contribution blocks are carried through as declared. They are shaped
  // by the host that reads them — a malformed option is Commander's complaint
  // to make, against the flag it was given — and a core that type-checked
  // every field of every front end's contributions would be a core that has to
  // be released whenever one of them grows a field.
  if (raw.core !== undefined) {
    if (!isPlainObject(raw.core)) return bad(`${name}: 'navbook.core' must be an object`);
    manifest.core = raw.core as PluginManifest["core"];
  }
  if (raw.cli !== undefined) {
    if (!isPlainObject(raw.cli)) return bad(`${name}: 'navbook.cli' must be an object`);
    manifest.cli = raw.cli as PluginManifest["cli"];
  }
  if (raw.server !== undefined) {
    if (!isPlainObject(raw.server)) return bad(`${name}: 'navbook.server' must be an object`);
    manifest.server = raw.server as PluginManifest["server"];
  }
  if (raw.web !== undefined) {
    if (typeof raw.web !== "boolean") return bad(`${name}: 'navbook.web' must be true or false`);
    manifest.web = raw.web;
  }

  const engines = isPlainObject(pkg.engines) ? pkg.engines.navbook : undefined;
  if (engines !== undefined && typeof engines !== "string") {
    return bad(`${name}: 'engines.navbook' must be a version range`);
  }

  return { ok: true, plugin: { name, version, manifest, engines: engines ?? null } };
}

/** True when `entry` sits inside `short`'s namespace (spec 02 §2.12). */
function ownsName(short: string, entry: string, isKey: boolean): boolean {
  return isKey ? entry.startsWith(`${short}-`) : entry === short;
}

/** True when a package's keywords mark it as a plugin. */
export function hasPluginKeyword(pkg: unknown): boolean {
  if (!isPlainObject(pkg)) return false;
  return isStringArray(pkg.keywords) && pkg.keywords.includes(PLUGIN_KEYWORD);
}

/* ----------------------------------------------------- version ranges */

/**
 * Whether a version satisfies a range, for the ranges a plugin may name.
 *
 * Written here rather than taken from `semver` because `core` pays for every
 * dependency twice: once in the startup budget (spec 05 §5.2) and once in the
 * Rust rewrite, which must reproduce whatever this does. What it must agree
 * with is npm, since the same range sits in `peerDependencies` where npm reads
 * it: `^1.2.3`, `~1.2`, `>=1.0.0 <2.0.0`, `1.2.3 - 2.x`, `1.x`, `*`, and `||`
 * between any of them, each desugared into plain comparisons the way npm's
 * `semver` does. A version with a prerelease tag satisfies none of them, as
 * it satisfies none in npm unless the range names that prerelease. Anything
 * outside this grammar is refused rather than guessed at, because a range
 * nobody can read is not evidence that a plugin is compatible.
 */
export function satisfiesRange(range: string, version: string): boolean {
  const target = parseVersion(version);
  if (target === null || target.prerelease) return false;
  return range.split("||").some((alternative) => {
    const comparators = desugar(alternative);
    return comparators?.every((test) => test(target.parts)) === true;
  });
}

type Version = [number, number, number];
type Comparator = (version: Version) => boolean;

function parseVersion(value: string): { parts: Version; prerelease: boolean } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (match === null) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  };
}

/**
 * A range's version part: up to three numbers, where `x`, `*` or a missing
 * part means "any". `null` for anything else, a fourth part included.
 */
function parsePartial(value: string): (number | null)[] | null {
  const trimmed = value.replace(/^v/, "");
  if (trimmed === "" || trimmed === "*" || trimmed === "x" || trimmed === "X") {
    return [null, null, null];
  }
  const segments = trimmed.split(".");
  if (segments.length > 3) return null;
  const parts: (number | null)[] = [];
  for (const segment of segments) {
    if (segment === "x" || segment === "X" || segment === "*") parts.push(null);
    else if (/^\d+$/.test(segment)) parts.push(Number(segment));
    else return null;
  }
  // A wildcard makes everything after it one too: `1.x.3` is `1.x`.
  const firstAny = parts.indexOf(null);
  while (parts.length < 3) parts.push(null);
  if (firstAny !== -1) parts.fill(null, firstAny);
  return parts;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const left = a[i] as number;
    const right = b[i] as number;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

const atLeast =
  (floor: Version): Comparator =>
  (v) =>
    compare(v, floor) >= 0;
const below =
  (ceiling: Version): Comparator =>
  (v) =>
    compare(v, ceiling) < 0;
const NOTHING: Comparator = () => false;

/** How many leading parts a partial version gives, before its first wildcard. */
function given(parts: (number | null)[]): number {
  const index = parts.indexOf(null);
  return index === -1 ? 3 : index;
}

/** The partial version's floor, wildcards as zero. */
function floorOf(parts: (number | null)[]): Version {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** The first version past everything the partial version covers. */
function pastOf(parts: (number | null)[]): Version | null {
  const count = given(parts);
  const [major = 0, minor = 0, patch = 0] = floorOf(parts);
  if (count === 0) return null;
  if (count === 1) return [major + 1, 0, 0];
  if (count === 2) return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/** One alternative of a range — no `||` — as the comparisons it stands for. */
function desugar(alternative: string): Comparator[] | null {
  // `>= 1.2.3` is `>=1.2.3`: npm allows the space, so it is not a separator.
  const text = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
  if (text === "") return [];

  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphen !== null) {
    const low = parsePartial(hyphen[1] as string);
    const high = parsePartial(hyphen[2] as string);
    if (low === null || high === null) return null;
    const out: Comparator[] = [atLeast(floorOf(low))];
    const past = pastOf(high);
    if (past !== null) out.push(below(past));
    return out;
  }

  const out: Comparator[] = [];
  for (const word of text.split(/\s+/)) {
    const comparators = desugarOne(word);
    if (comparators === null) return null;
    out.push(...comparators);
  }
  return out;
}

function desugarOne(word: string): Comparator[] | null {
  const match = /^(>=|<=|>|<|\^|~|=)?(.*)$/.exec(word);
  if (match === null) return null;
  const [, sign = "", rest = ""] = match;
  const parts = parsePartial(rest);
  if (parts === null) return null;
  const count = given(parts);
  const floor = floorOf(parts);
  const past = pastOf(parts);

  switch (sign) {
    case "":
    case "=":
      return past === null ? [] : [atLeast(floor), below(past)];
    case ">=":
      return [atLeast(floor)];
    case "<":
      return count === 0 ? [NOTHING] : [below(floor)];
    case ">":
      // Past everything the partial covers: `>1.2` is `>=1.3.0`.
      return past === null ? [NOTHING] : [atLeast(past)];
    case "<=":
      return past === null ? [] : [below(past)];
    case "~": {
      // `~1.2.3` and `~1.2` pin the minor; `~1` pins only the major.
      if (count === 0) return [];
      const [major, minor] = floor;
      const ceiling: Version = count === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
      return [atLeast(floor), below(ceiling)];
    }
    case "^": {
      // Changes that leave the left-most non-zero part given alone: below
      // 1.0.0 the minor is the boundary, and below 0.1.0 the patch is.
      if (count === 0) return [];
      const [major, minor, patch] = floor;
      let ceiling: Version;
      if (major > 0 || count === 1) ceiling = [major + 1, 0, 0];
      else if (minor > 0 || count === 2) ceiling = [0, minor + 1, 0];
      else ceiling = [0, 0, patch + 1];
      return [atLeast(floor), below(ceiling)];
    }
    default:
      return null;
  }
}

/* ------------------------------------------------- the declaration */

/** What a marker's `plugins` key says, and what was wrong with it. */
export interface PluginDeclarationReading {
  /** Package name to the settings declared under it; empty when none are. */
  plugins: Map<string, Record<string, unknown>>;
  /** True when the marker carries a usable `plugins` object, however partial. */
  declared: boolean;
  /** One message per fault, in key order; empty when there is nothing wrong. */
  problems: string[];
}

/**
 * The reading of a repository that declares nothing, which is most of them.
 *
 * Frozen, and never handed out: {@link parsePluginDeclaration} returns a fresh
 * reading on every call, so a caller that adds to the one it was given changes
 * no other reading — the server's, which lives as long as the process,
 * especially (#gqu14qtl). A Map cannot be frozen, so this one is for comparing
 * against only.
 */
export const NO_PLUGINS: PluginDeclarationReading = Object.freeze({
  plugins: new Map(),
  declared: false,
  problems: [],
});

function nothingDeclared(problems: string[] = []): PluginDeclarationReading {
  return { plugins: new Map(), declared: false, problems };
}

/**
 * Read the plugin declaration out of a marker's text (spec 02 §2.12).
 *
 * Shaped exactly like {@link parseReviewPolicy}, and for the same reason: a
 * fault here is a fault in the file that names a directory, not in the
 * entities inside it, so every reader falls back to declaring nothing, reports
 * the fault (D15), and carries on. A malformed entry drops that entry rather
 * than the whole declaration — one mistyped plugin should not take the others
 * with it.
 */
export function parsePluginDeclaration(markerText: string | undefined): PluginDeclarationReading {
  if (markerText === undefined) return nothingDeclared();

  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    // The same text that made the policy reader say this; whichever runs first
    // reports it, and D15 is emitted once per distinct fault.
    return nothingDeclared(["is not valid JSON"]);
  }
  if (!isPlainObject(marker)) return nothingDeclared(["is not a JSON object"]);

  const declaration = marker.plugins;
  if (declaration === undefined) return nothingDeclared();
  if (!isPlainObject(declaration)) return nothingDeclared(["'plugins' must be an object"]);

  const plugins = new Map<string, Record<string, unknown>>();
  const problems: string[] = [];
  for (const [name, settings] of Object.entries(declaration)) {
    // The key is the extension's own name, whose grammar §2.12 leaves to
    // whoever names extensions; it must only be a name, which "" is not.
    if (name === "") {
      problems.push(`'plugins' has an entry with an empty name`);
      continue;
    }
    if (!isPlainObject(settings)) {
      problems.push(`'plugins.${name}' must be an object of settings`);
      continue;
    }
    plugins.set(name, settings);
  }

  return { plugins, declared: true, problems };
}
