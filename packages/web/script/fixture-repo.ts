/**
 * A Navbook repository worth looking at, built from nothing.
 *
 * `nuxi dev` and the end-to-end suite both need a repository the server can
 * serve, and neither should use the one you are standing in: every mutation
 * commits, so a stray click while developing would file a real issue against
 * Navbook itself. This builds a throwaway one instead, with an origin to push
 * to so the `pushed` half of every mutation is exercised too.
 *
 * It is the one place in this package that imports `@navbook/core`, and it is
 * allowed to because it never reaches the browser: it is a Node script that
 * writes files, standing in for the person who would otherwise have run `nav`
 * a dozen times. Nothing it does is a shortcut — every entity here is composed
 * by the same functions the CLI composes them with.
 *
 * The seeded content is chosen for the cases that are hard to reach by
 * clicking: a subtask tree with a cycle and a repeat in it, a comment that
 * replies to another, a review bound to a revision, and a pull request on a
 * branch the server does not have checked out — the one that must refuse a
 * comment and say which branch to serve.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  addSpec,
  applyComment,
  closeEntity,
  createFeature,
  currentAuthor,
  findEntity,
  makeWsCtx,
  newCommentFile,
  newFeatureFile,
  newIssueFile,
  newPrFile,
  newSpecFile,
  openIssue,
  openPr,
  parseFile,
  preparePrOpen,
  readRevisions,
  specFileName,
} from "@navbook/core";

/** Fixed so a screenshot, a diff and an assertion all say the same thing. */
export const FIXTURE_DATE = "2026-08-01T10:00:00Z";
export const COMMITTER = { name: "Navbook Dev Server", email: "dev-server@example.invalid" };

/** The branch the seeded pull request lives on, and which the server serves. */
export const SERVED_BRANCH = "feat/served";
/** A pull request on a branch the server does not hold; commenting must refuse. */
export const UNSERVED_BRANCH = "feat/unserved";

export interface FixtureRepo {
  /** The clone the server should be pointed at. */
  dir: string;
  /** The branch it is left on, and the one the server therefore serves. */
  branch: string;
  /** The bare repository it pushes to. */
  origin: string;
  /** Environment that pins git's identity and dates. */
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

export interface FixtureOptions {
  /** Where to build it; a fresh temporary directory by default. */
  root?: string;
  /** Ids to mint, in order. Fixed ids make the suite's URLs predictable. */
  ids?: string[];
}

/**
 * Ids the seed mints, in the order it mints them.
 *
 * Spelled out rather than random so an end-to-end test can navigate straight
 * to `/issues/aaaa0001` — and so the ones that must relate to each other
 * (parent, child, the cycle) can be written down here rather than discovered.
 */
export const IDS = {
  parent: "aaaa0001",
  child: "aaaa0002",
  grandchild: "aaaa0003",
  loop: "aaaa0004",
  // Deliberately unlike the others: every reference accepts an unambiguous
  // prefix of four characters or more, and with ids that all begin `aaaa`
  // there would be no way to exercise that.
  plain: "cafe0005",
  closed: "aaaa0006",
  edgeCases: "aaaa0007",
  // Three assigned issues that say where they sit and when they are wanted,
  // so the inbox has a queue to sort and to reorder.
  urgent: "aaaa0008",
  next: "aaaa0009",
  someday: "aaaa0010",
  servedPr: "bbbb0001",
  unservedPr: "bbbb0002",
  declinedPr: "bbbb0003",
} as const;

function envFor(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TZ: "UTC",
    LC_ALL: "C",
    LANG: "C",
    NO_COLOR: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: COMMITTER.name,
    GIT_AUTHOR_EMAIL: COMMITTER.email,
    GIT_COMMITTER_NAME: COMMITTER.name,
    GIT_COMMITTER_EMAIL: COMMITTER.email,
  };
}

/** Build the repository, and return where it is. */
export function createFixtureRepo(options: FixtureOptions = {}): FixtureRepo {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "navbook-web-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const env = envFor(home);

  const git = (cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...env, ...extra } });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${result.stderr}`);
    }
    return result.stdout;
  };

  const origin = join(root, "origin.git");
  spawnSync("git", ["init", "--quiet", "--bare", "-b", "main", origin], { env });

  const dir = join(root, "clone");
  git(root, ["clone", "--quiet", origin, dir]);
  git(dir, ["config", "user.name", COMMITTER.name]);
  git(dir, ["config", "user.email", COMMITTER.email]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  const write = (relative: string, content: string): void => {
    const target = join(dir, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  };

  // The skeleton as `nav init` writes it, plus a review policy — because the
  // served pull request has exactly one approval, and asking for two is what
  // makes the shortfall visible on the page without anybody arranging it
  // (spec 02 §2.10).
  write(
    ".navbook/navbook.json",
    `${JSON.stringify({ version: 1, review: { selfReview: false, minApprovals: 2 } }, null, 2)}\n`,
  );
  for (const path of ["issues/open", "issues/closed", "prs/open", "prs/merged", "prs/closed"]) {
    write(`.navbook/${path}/.gitkeep`, "");
  }
  write("README.md", "# A repository with a Navbook tree in it\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", "docs(navbook): initialise"], {
    GIT_AUTHOR_DATE: FIXTURE_DATE,
    GIT_COMMITTER_DATE: FIXTURE_DATE,
  });

  seed(dir, env, git, write);

  git(dir, ["push", "--quiet", "origin", "main"]);
  git(dir, ["push", "--quiet", "origin", SERVED_BRANCH]);
  git(dir, ["push", "--quiet", "origin", UNSERVED_BRANCH]);

  // A pull request's files live on the branch it proposes to merge (spec 03
  // §3.5), so which branch the clone is on decides which pull requests the
  // server can read and comment on. It is left on the served one: from there
  // both are visible to `prs(allRefs: true)`, one is commentable, and the
  // other must refuse and name its branch.
  git(dir, ["checkout", "--quiet", SERVED_BRANCH]);
  git(dir, ["branch", "-D", UNSERVED_BRANCH]);
  git(dir, ["fetch", "--quiet", "origin"]);
  git(dir, ["branch", `--set-upstream-to=origin/${SERVED_BRANCH}`, SERVED_BRANCH]);

  return {
    dir,
    branch: SERVED_BRANCH,
    origin,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

type Git = (cwd: string, args: string[], extra?: NodeJS.ProcessEnv) => string;
type Write = (relative: string, content: string) => void;

function seed(dir: string, env: NodeJS.ProcessEnv, git: Git, write: Write): void {
  const at = (date: string, ids: string[]): NodeJS.ProcessEnv => ({
    ...env,
    NAV_NOW: date,
    NAV_IDS: ids.join(","),
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });

  const ws = (date: string, ids: string[]) => makeWsCtx({ cwd: dir, env: at(date, ids) });

  const issue = (
    date: string,
    id: string,
    input: {
      title: string;
      body: string;
      labels?: string[];
      assignee?: string[];
      milestone?: string;
      features?: string[];
      rank?: number;
      deadline?: string;
      parent?: string;
      author?: string;
    },
  ): void => {
    const context = ws(date, [id]);
    openIssue(
      context,
      {
        content: newIssueFile({
          title: input.title,
          author: input.author ?? currentAuthor(context),
          created: date,
          body: input.body,
          ...(input.labels ? { labels: input.labels } : {}),
          ...(input.assignee ? { assignee: input.assignee } : {}),
          ...(input.milestone ? { milestone: input.milestone } : {}),
          ...(input.features ? { features: input.features } : {}),
          // Absence rather than falsehood: a rank of zero is a position.
          ...(input.rank === undefined ? {} : { rank: input.rank }),
          ...(input.deadline ? { deadline: input.deadline } : {}),
          ...(input.parent ? { parent: input.parent } : {}),
        }),
        fallbackTitle: input.title,
      },
      { commit: true },
    );
  };

  const comment = (
    date: string,
    id: string,
    kind: "issue" | "pr",
    ref: string,
    input: {
      body: string;
      author?: string;
      replyTo?: string;
      verdict?: "approve" | "request-changes" | "comment";
      revision?: string;
      file?: string;
      line?: string;
    },
  ): void => {
    const context = ws(date, [id]);
    const entity = findEntity(context, kind, ref);
    const review = input.verdict !== undefined;
    applyComment(
      context,
      entity,
      {
        content: newCommentFile({
          author: input.author ?? currentAuthor(context),
          body: input.body,
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.verdict ? { verdict: input.verdict } : {}),
          ...(input.revision ? { revision: input.revision } : {}),
          ...(input.file ? { file: input.file } : {}),
          ...(input.line ? { line: input.line } : {}),
        }),
        review,
      },
      { commit: true },
    );
  };

  /* ------------------------------------------------------------- features */

  const feature = (
    date: string,
    slug: string,
    input: { title: string; summary?: string },
  ): void => {
    const context = ws(date, []);
    createFeature(
      context,
      {
        content: newFeatureFile({
          title: input.title,
          author: currentAuthor(context),
          created: date,
          ...(input.summary ? { body: input.summary } : {}),
        }),
        slug,
        fallbackTitle: input.title,
      },
      { commit: true },
    );
  };

  const spec = (date: string, slug: string, input: { title: string; body: string }): void => {
    const context = ws(date, []);
    addSpec(
      context,
      slug,
      {
        content: newSpecFile({ title: input.title, body: input.body }),
        fileName: specFileName(input.title),
      },
      { commit: true },
    );
  };

  feature("2026-07-15T09:00:00Z", "authentication", {
    title: "Authentication",
    summary: [
      "Everything about proving who somebody is: the sign-in form, the session",
      "it opens, and the tokens that keep it open.",
    ].join("\n"),
  });
  spec("2026-07-15T09:30:00Z", "authentication", {
    title: "Login flow",
    body: [
      "## Requirements",
      "",
      "The form SHALL accept an address and a password, and SHALL NOT give up",
      "on a request before the server has had ten seconds to answer it.",
      "",
      "## Scenarios",
      "",
      "WHEN the connection is slow, THEN the form waits rather than failing.",
    ].join("\n"),
  });
  spec("2026-07-16T10:00:00Z", "authentication", {
    title: "Session policy",
    body: [
      "## Requirements",
      "",
      "A session SHALL last thirty days, and SHALL end at once when the",
      "password behind it changes.",
    ].join("\n"),
  });

  // A feature with nothing written down yet: the empty state has to look like
  // something too.
  feature("2026-07-20T09:00:00Z", "billing", {
    title: "Billing",
    summary: "Seats, invoices, and what happens when a card is refused.",
  });

  /* --------------------------------------------------------------- issues */

  issue("2026-08-01T10:00:00Z", IDS.parent, {
    title: "Sign-in is unreliable on slow connections",
    body: [
      "The sign-in form gives up before a slow connection has answered.",
      "",
      "Reproducing it needs throttling to 3G; on a fast link it never happens.",
      "",
      "- [ ] find where the deadline is set",
      "- [ ] make it configurable",
      "",
      "See `app/auth/session.ts` for where the timeout lives.",
    ].join("\n"),
    labels: ["bug", "auth"],
    features: ["authentication"],
    assignee: ["A Person <person@example.invalid>"],
    milestone: "1.0",
  });

  issue("2026-08-02T09:15:00Z", IDS.child, {
    title: "Raise the sign-in deadline to thirty seconds",
    body: "Five seconds is not enough on a throttled connection.",
    labels: ["bug"],
    features: ["authentication"],
    parent: IDS.parent,
  });

  issue("2026-08-02T09:30:00Z", IDS.grandchild, {
    title: "Make the deadline configurable",
    body: "Read it from configuration rather than hard-coding it.",
    parent: IDS.child,
  });

  // A loop: this one is filed under its own grandchild, so the tree beneath
  // the parent reaches it and stops. Nothing prevents this on disk, so the
  // client has to survive it.
  issue("2026-08-02T09:45:00Z", IDS.loop, {
    title: "A subtask whose parent chain loops",
    body: "Filed under its own descendant, which is a thing files can say.",
    parent: IDS.grandchild,
  });

  issue("2026-08-03T14:12:00Z", IDS.plain, {
    title: "Document the query syntax",
    body: [
      "The `list` filters are not written down anywhere a newcomer would look.",
      "",
      "> Terms AND together; the default query is `status:open`.",
    ].join("\n"),
    labels: ["documentation"],
    features: ["authentication", "billing"],
    assignee: ["Someone Else <someone@example.invalid>"],
    author: "Someone Else <someone@example.invalid>",
  });

  // Assigned, and then closed: the one piece of finished work with somebody's
  // name still on it, which is what an inbox asked for finished work must find.
  issue("2026-07-20T08:00:00Z", IDS.closed, {
    title: "Timestamps render in the wrong timezone",
    body: "Everything was an hour out for anyone not on UTC.",
    labels: ["bug"],
    assignee: ["A Person <person@example.invalid>"],
    milestone: "1.0",
  });
  closeEntity(
    ws("2026-07-28T16:40:00Z", []),
    "issue",
    IDS.closed,
    { resolution: "fixed" },
    { commit: true },
  );

  /*
   * Three placed and dated issues, all assigned to the person the suite signs
   * in as, so the inbox has a queue to sort and to reorder.
   *
   * Their ranks are ten apart, which is the gap a drop between two of them
   * halves. Their deadlines run the other way from their ranks and they are
   * filed newest last, so that no assertion about one order can pass by
   * accident under another.
   */
  issue("2026-08-05T09:00:00Z", IDS.urgent, {
    title: "Rotate the signing keys",
    body: "Overdue, and first in the queue.",
    labels: ["security"],
    assignee: ["A Person <person@example.invalid>"],
    rank: 10,
    // Long past by the time anybody runs this, which is the point: an overdue
    // badge and an overdue filter both need something reliably late.
    deadline: "2026-08-01",
  });

  issue("2026-08-06T09:00:00Z", IDS.next, {
    title: "Write the migration guide",
    body: "Placed, and wanted on no particular day.",
    assignee: ["A Person <person@example.invalid>"],
    rank: 20,
  });

  issue("2026-08-07T09:00:00Z", IDS.someday, {
    title: "Replace the colour picker",
    body: "Wanted one day, and not placed at all.",
    assignee: ["A Person <person@example.invalid>"],
    deadline: "2099-12-31",
  });

  // Every state a decomposition link can be in, in one place. Four of the five
  // cannot be reached by clicking — a link to a pull request, a dangling id, a
  // loop and a repeat all need a file somebody wrote by hand, which is exactly
  // what the format lets somebody do. The list is therefore written by hand
  // too, after the issue is opened normally, so the file stays well formed.
  //
  // The order matters. `subtaskTree` expands the first occurrence of an issue
  // and marks later, shallower-or-equal ones `repeated`, so #aaaa0003 is listed
  // before the #aaaa0002 that also holds it.
  issue("2026-08-03T15:00:00Z", IDS.edgeCases, {
    title: "A subtask list with every edge case in it",
    body: [
      "Not a real report: a fixture for the subtask tree.",
      "",
      "It lists a subtask that is really a pull request, an id that names",
      "nothing, itself, and an issue already shown above it.",
    ].join("\n"),
    labels: ["fixture"],
  });
  const edgePath = join(
    dir,
    ".navbook/issues/open",
    `${IDS.edgeCases}-a-subtask-list-with-every-edge-case-in-it`,
    "issue.md",
  );
  writeFileSync(
    edgePath,
    readFileSync(edgePath, "utf8").replace(
      /^labels: .*$/m,
      (line) =>
        `${line}\nsubtasks: [${IDS.grandchild}, ${IDS.child}, ${IDS.servedPr}, dddd9999, ${IDS.edgeCases}]`,
    ),
    "utf8",
  );
  git(dir, ["add", "-A"]);
  git(
    dir,
    [
      "commit",
      "--quiet",
      "-m",
      `docs(issue): hand-write the subtask edge cases on #${IDS.edgeCases}`,
    ],
    {
      GIT_AUTHOR_DATE: "2026-08-03T15:05:00Z",
      GIT_COMMITTER_DATE: "2026-08-03T15:05:00Z",
    },
  );

  // A commit that touches no Navbook file at all. It reaches the feature's
  // timeline through the trailer it carries, which is the whole reason the
  // timeline reads history rather than the tree (spec 04 §4.3).
  write("app/auth/session.ts", "export const DEADLINE_MS = 30_000;\n");
  git(dir, ["add", "-A"]);
  git(
    dir,
    ["commit", "--quiet", "-m", `fix: raise the sign-in deadline\n\nCloses: ${IDS.child}\n`],
    {
      GIT_AUTHOR_DATE: "2026-08-02T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-02T12:00:00Z",
    },
  );

  comment("2026-08-01T11:00:00Z", "cccc0001", "issue", IDS.parent, {
    body: "I can reproduce this with the network throttled to 3G.",
    author: "Someone Else <someone@example.invalid>",
  });
  comment("2026-08-01T11:30:00Z", "cccc0002", "issue", IDS.parent, {
    body: "Same here. The deadline looks like it is five seconds.",
    replyTo: "cccc0001",
  });

  /* -------------------------------------------------- pull requests */

  /** The head a pull request pinned when it was opened, read back from its file. */
  const pinnedRevision = (id: string): string => {
    const context = ws(FIXTURE_DATE, []);
    const entity = findEntity(context, "pr", id);
    const revisions = readRevisions(
      parseFile(readFileSync(join(dir, ".navbook", entity.filePath), "utf8")).fm,
    );
    const head = revisions[revisions.length - 1]?.head;
    if (head === undefined) throw new Error(`#${id} pinned no revision`);
    return head;
  };

  interface PrInput {
    title: string;
    body: string;
    labels?: string[];
    assignee?: string[];
    reviewers?: string[];
    draft?: boolean;
  }

  /** Open a pull request for the branch this is standing on. */
  const openPrHere = (date: string, id: string, input: PrInput): void => {
    const context = ws(date, [id]);
    const draft = preparePrOpen(context, { title: input.title });
    openPr(
      context,
      {
        content: newPrFile({
          title: input.title,
          author: currentAuthor(context),
          created: date,
          body: input.body,
          target: draft.target,
          source: draft.source,
          revisions: [draft.revision],
          ...(input.labels ? { labels: input.labels } : {}),
          ...(input.assignee ? { assignee: input.assignee } : {}),
          ...(input.reviewers ? { reviewers: input.reviewers } : {}),
          ...(input.draft ? { draft: true } : {}),
        }),
        fallbackTitle: input.title,
      },
      { commit: true },
    );
  };

  /** The same, on a branch of its own with a commit for it to propose. */
  const openPrOn = (date: string, id: string, branch: string, input: PrInput): void => {
    git(dir, ["checkout", "--quiet", "-b", branch]);
    const name = branch.replaceAll("/", "-");
    write(`${name}.txt`, `work on ${branch}\n`);
    // And one file past the size the server sends inline, so the Changes tab
    // has a "Load diff" to click (`INLINE_FILE_LINES` in the server).
    write(
      `generated/${name}.txt`,
      `${Array.from({ length: 1_200 }, (_, i) => `line ${i + 1} of ${branch}`).join("\n")}\n`,
    );
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", `feat: ${input.title}`], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    openPrHere(date, id, input);
    git(dir, ["checkout", "--quiet", "main"]);
  };

  // Two assignees, which is the only place the fixture writes a person key as
  // a list rather than a scalar (spec 02 §2.5) — and the only pull request
  // anybody's inbox holds for having been given it rather than written.
  openPrOn("2026-08-04T10:00:00Z", IDS.servedPr, SERVED_BRANCH, {
    title: "Raise the sign-in deadline",
    body: "Thirty seconds, and configurable. Closes the subtask under #aaaa0001.",
    labels: ["bug"],
    assignee: ["A Person <person@example.invalid>", `${COMMITTER.name} <${COMMITTER.email}>`],
    reviewers: ["someone@example.invalid"],
  });

  // Asked of the person the suite signs in as, and on the branch nothing can
  // write to — so what this request looks like from the outside stays put
  // however much the rest of the suite reviews the other pull request.
  openPrOn("2026-08-05T10:00:00Z", IDS.unservedPr, UNSERVED_BRANCH, {
    title: "A pull request this server does not serve",
    body: "Its files live on a branch the clone does not have checked out.",
    draft: true,
    reviewers: ["person@example.invalid"],
  });

  // A comment and a review on the served pull request, written on its branch
  // because that is where its directory is.
  git(dir, ["checkout", "--quiet", SERVED_BRANCH]);
  comment("2026-08-04T11:00:00Z", "cccc0003", "pr", IDS.servedPr, {
    body: "Thirty seconds still feels short for a satellite link, but it is better.",
    author: "Someone Else <someone@example.invalid>",
  });
  // The revision the pull request actually pinned, not whatever HEAD has since
  // become: a verdict names a recorded revision (spec 02 §2.7), and one that
  // named anything else would be a review of a state nobody offered — which is
  // what doctor check D6 reports.
  comment("2026-08-04T12:00:00Z", "cccc0004", "pr", IDS.servedPr, {
    body: "Reads well. One note on the constant's name.",
    // By one of the people it asked, so the panel shows an answered request.
    author: "Someone Else <someone@example.invalid>",
    verdict: "approve",
    revision: pinnedRevision(IDS.servedPr),
    file: "app/auth/session.ts",
    line: "42-48",
  });

  // A pull request that is over, opened and closed on the branch the server
  // serves so the working tree is where it ends up. The cross-branch scan
  // finds open pull requests only, so this is the one that proves a finished
  // pull request is looked for somewhere else entirely.
  openPrHere("2026-08-06T09:00:00Z", IDS.declinedPr, {
    title: "An approach to the deadline that was not taken",
    body: "Kept because a road not travelled is worth being able to find.",
    assignee: ["A Person <person@example.invalid>"],
  });
  closeEntity(
    ws("2026-08-06T15:00:00Z", []),
    "pr",
    IDS.declinedPr,
    { resolution: "declined" },
    { commit: true },
  );

  git(dir, ["checkout", "--quiet", "main"]);
}
