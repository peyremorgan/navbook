/**
 * What a plugin's entry module is handed — spec 05 §5.2.
 *
 * Each entry exports `activate(host)`. The host carries three things: the
 * running core, the settings the repository declared, and the hooks for
 * registering what this layer accepts.
 *
 * `core` is the host's own module object, not something the plugin imported.
 * That is the single most important line in this file. A plugin resolving its
 * own `@navbook/core` would get a second copy, and then `instanceof
 * WorkspaceError` would be false across the boundary, two YAML parsers would
 * sit on the startup path, and two `Repo` types that are structurally
 * identical would be nominally different. The store installs with
 * `--omit=peer` so that copy cannot exist; this is how the plugin gets the
 * real one instead.
 */

import type { CorePluginHost, EntityRecord, Repo } from "@navbook/core";
import type { Composed, ComposeOptions } from "../commands/compose.ts";
import type { ExtraColumn } from "../commands/entity.ts";
import type { Ctx } from "../context.ts";

/** What every entry module exports. */
export interface PluginEntry<H> {
  activate(host: H): void | Promise<void>;
}

// `CorePluginHost` is core's own: every front end builds one, and a plugin
// typing against it should not depend on whichever is loading it.
export type { CorePluginHost };

/**
 * What a plugin adds to a command that already exists.
 *
 * Every field here has a seam in the CLI that predates plugins: `columns` and
 * `jsonExtra` are what `nav pr list --all-refs` already uses to add its `refs`
 * column, and `showSection` is the same idea for a detail view. A plugin
 * contributing through them renders identically to a built-in, which is the
 * point — `nav issue list` should not look like it has a bolt-on.
 */
export interface VerbHandlers {
  /**
   * Frontmatter for a newly created entity, read off this verb's options.
   *
   * Returns what `NewEntityInput.ext` takes, so the plugin's keys are written
   * by the same composer that writes the format's own.
   */
  openFields?(opts: Record<string, unknown>): Record<string, string | readonly string[]>;
  /** Columns appended to this listing, after the built-in ones. */
  columns?: ExtraColumn[];
  /** Keys merged into this command's `--json` object, per entity. */
  jsonExtra?(entity: EntityRecord): Record<string, unknown>;
  /** Lines appended to this `show`, after the built-in detail. */
  showSection?(entity: EntityRecord, repo: Repo): string[];
  /** Candidates offered for this command's query terms, e.g. `feature:auth`. */
  listCompletions?(): string[];
}

/** What the `./cli` entry is given: the core host, plus the terminal. */
export interface CliPluginHost extends CorePluginHost {
  /** Where output goes, who is acting, and where the repository is. */
  ctx: Ctx;
  /**
   * Implement a command the manifest declared.
   *
   * `path` is the command as typed, without `nav`: `"feature open"`, or
   * `"feature spec add"`. A path the manifest does not declare is refused,
   * because the manifest is what built the help and the completions, and a
   * command that runs but is not in either would be worse than one that does
   * not run.
   */
  command(
    path: string,
    run: (args: string[], opts: Record<string, unknown>) => void | Promise<void>,
  ): void;
  /** Implement contributions to an existing verb the manifest declared. */
  contribute(on: string, handlers: VerbHandlers): void;
  /** Answer completion for an argument whose spec names this completer. */
  completer(id: string, complete: (words: string[]) => string[]): void;
  /** The terminal conveniences, so a plugin's output matches a built-in's. */
  ui: CliPluginUi;
}

/**
 * The parts of the CLI a plugin may use to talk to the terminal.
 *
 * Named rather than handed the modules wholesale: this is the surface the
 * plugin API version promises, and a plugin reaching past it into the CLI's
 * internals would break on a refactor nobody thought was a breaking change.
 */
export interface CliPluginUi {
  /** Stop with an operational error (exit 1), as every built-in verb does. */
  fail(message: string, details?: string[]): never;
  /** Stop with a format violation (exit 2), as `doctor` does. */
  failFormat(message: string, details?: string[]): never;
  /** Ask a yes/no question; anything but yes is a no. */
  askYesNo(question: string): boolean;
  /**
   * Ask a question and read one line of answer; null at the end of input.
   *
   * The same stdin every built-in question reads, so a plugin's questions can
   * be answered by a pipe exactly as `nav pr merge`'s can.
   */
  ask(question: string): string | null;
  /** Whether somebody is at a terminal to answer: stdin and stdout both a TTY. */
  isInteractive(): boolean;
  /**
   * Edit text in `$EDITOR` and return what was saved.
   *
   * For text that is not yet a file — a note, a paragraph of a record the
   * plugin is composing. The buffer lives in the git directory and is removed
   * afterwards; nothing appears in the tree.
   */
  editText(bufferName: string, initial: string): string;
  /** Print what will happen, ask once, then do it — the `nav install` shape. */
  confirmAndPerform(opts: {
    title: string;
    actions: readonly { description: string; perform: () => void }[];
    assumeYes?: boolean;
  }): boolean;
  /**
   * Produce the text of a new file, from `-m` or from `$EDITOR`.
   *
   * The whole composing path rather than the editor alone, because what makes
   * a hand-edited buffer safe is that it is parsed and validated before
   * anything is written — and a plugin opening `$EDITOR` itself would have to
   * reproduce that, and would eventually reproduce it slightly differently.
   */
  composeFile(opts: ComposeOptions): Composed;
  /** Open `$EDITOR` on a file already in the tree, as `nav issue edit` does. */
  editFile(absolutePath: string): void;
  /** Render a table sized to the terminal, the way every listing does. */
  renderTable(
    columns: readonly { header: string; flexible?: boolean; minWidth?: number }[],
    rows: readonly string[][],
  ): string;
  /**
   * Pad text with spaces to `width` terminal columns, measured as a listing
   * measures its cells — so a wide or combining character lines up.
   */
  pad(text: string, width: number): string;
  /** The one-line report printed after a `--commit` run. */
  commitReport(result: { committed: boolean; subject: string }): string;
  /** Collect a repeatable option's values, for a manifest that declares one. */
  collect(value: string, previous: string[]): string[];
  /**
   * Write to a pull request where it lives, as `nav pr comment` does.
   *
   * Its files are on its source branch (spec 03 §3.5). When this checkout does
   * not have that branch, the write happens in the clean worktree that does,
   * or in a temporary one — after asking, unless `assumeYes` answered already.
   * `write` gets the context to write in and the pull request as read there;
   * when the write cannot move, this fails naming the branch.
   *
   * `write` is synchronous. The site is held only while it runs — a temporary
   * worktree is released, and Ctrl-C given back, as soon as it returns — so a
   * callback returning a promise fails the command, as a write that threw
   * does. Do anything asynchronous first, and write inside without awaiting.
   */
  withPrWriteSite<T>(
    prefix: string,
    opts: { assumeYes?: boolean },
    write: (at: Ctx, entity: EntityRecord) => T,
  ): T;
  /**
   * Write on a local branch that may not be the one checked out here, as
   * `nav pr open --source` does: here, in the clean worktree that has it, or in
   * a temporary one, asking first unless `assumeYes` answered already.
   *
   * `branch` is a branch's name, never a revision such as `main~1`; `write` is
   * synchronous, as for {@link withPrWriteSite}.
   */
  withBranchWriteSite<T>(branch: string, opts: { assumeYes?: boolean }, write: (at: Ctx) => T): T;
}
