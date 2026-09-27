/**
 * How a tracker commit reads on the Changes tab: a verb badge, one sentence
 * and a chip per fact.
 *
 * The server has already said what each commit did (`Pr.activity`); nothing
 * here reads the format. This only puts words to the verbs and the facts, so
 * the sentence is the same wherever a commit is shown.
 */

import type { Kind } from "~~/src/generated/gql/graphql";

export interface ActivityFact {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ActivityCommit {
  subject: string;
  verb: string | null;
  kind: Kind | null;
  entity: string | null;
  facts: readonly ActivityFact[];
}

/**
 * One sentence in three parts, so the record between them can be a link:
 * `lead`, then the record (when there is one to name), then `tail`, whose
 * `emphasis` is set in bold.
 */
export interface ActivitySentence {
  lead: string;
  /** Null when the sentence names no record, or names the page's own one. */
  record: { label: string; to: string } | null;
  tail: string;
  emphasis: string | null;
}

const LEAD: Record<string, string> = {
  open: "Opened",
  close: "Closed",
  reopen: "Reopened",
  merge: "Merged",
  edit: "Edited",
  update: "Pinned a new revision of",
  comment: "Commented on",
  review: "Reviewed",
  "request review": "Asked for a review of",
  delete: "Deleted",
  link: "Linked",
  unlink: "Unlinked",
};

const NOUN: Record<Kind, string> = { ISSUE: "issue", PR: "pull request" };

function recordPath(kind: Kind, entity: string): string {
  return `${kind === "ISSUE" ? "/issues" : "/prs"}/${entity}`;
}

/**
 * The sentence for one commit. `self` is the pull request whose page this is,
 * which the sentence calls "this pull request" rather than linking to itself.
 */
export function activitySentence(commit: ActivityCommit, self: string): ActivitySentence {
  const lead = commit.verb === null ? undefined : LEAD[commit.verb];
  if (lead === undefined || commit.kind === null || commit.entity === null) {
    // Nothing the server could name: the subject is what the author wrote.
    return { lead: commit.subject, record: null, tail: "", emphasis: null };
  }
  const resolution = commit.facts.find((fact) => fact.field === "resolution")?.after ?? null;
  const verdict = commit.facts.find((fact) => fact.field === "verdict")?.after ?? null;
  const emphasis =
    commit.verb === "close" && resolution !== null
      ? resolution
      : commit.verb === "review" && verdict !== null
        ? verdict.replace("-", " ")
        : null;
  const tail = emphasis === null ? "" : commit.verb === "close" ? " as" : ": ";
  if (commit.kind === "PR" && commit.entity === self) {
    return { lead: `${lead} this pull request`, record: null, tail, emphasis };
  }
  return {
    lead: `${lead} ${NOUN[commit.kind]}`,
    record: { label: `#${commit.entity}`, to: recordPath(commit.kind, commit.entity) },
    tail,
    emphasis,
  };
}

/** A fact as its chip reads: `resolution: fixed`, `labels: bug → bug, cli`. */
export function factLabel(fact: ActivityFact): { field: string; value: string } {
  if (fact.before === null) return { field: fact.field, value: fact.after ?? "" };
  return { field: fact.field, value: `${fact.before} → ${fact.after ?? "—"}` };
}

/** The badge colour of a verb: made, ended, talked about, or changed. */
export function verbColor(verb: string | null): "success" | "secondary" | "info" | "neutral" {
  switch (verb) {
    case "open":
    case "reopen":
      return "success";
    case "close":
    case "merge":
    case "delete":
      return "secondary";
    case "comment":
    case "review":
    case "request review":
      return "info";
    default:
      return "neutral";
  }
}
