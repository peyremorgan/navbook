/**
 * The inbox: three questions about one person, merged into one list.
 *
 * The server answers each of them separately — assigned, authored, asked to
 * review — because `EntityFilter` ANDs its keys and there is no way to ask for
 * a union. So the union is made here, and which question an entity came back
 * in is kept, because that is the only thing that says *why* a row is in
 * somebody's inbox. Nothing here compares one address with another: the client
 * does not decide who somebody is (`app/utils/people.ts`), it only remembers
 * which answer an entity arrived in.
 *
 * Merging does not order: the page decides that, because the inbox is the one
 * listing that defaults to priority rather than to the order the answers
 * arrived in (spec 02 §2.5). What is guaranteed here is only that every entity
 * appears once, carrying every reason it has.
 */

import { splitTerms } from "~/utils/filter-params";
import { compareBy, type Sortable, type SortOrder } from "~/utils/sort";
import type {
  InboxQueryVariables,
  IssueListItemFragment,
  PrListItemFragment,
} from "~~/src/generated/gql/graphql";

/** What an entity in the inbox is; a feature is never one. */
export type InboxKind = "issue" | "pr";

/**
 * Why a row is here.
 *
 * `awaiting` is the review a person still owes: being listed as a reviewer is
 * the request, and answering the latest revision is what takes it off the list
 * (spec 02 §2.7). Nothing has to be marked read — the files say when it is done.
 */
export type InboxReason = "assigned" | "author" | "awaiting";

/** Fixed, so two rows carrying the same reasons wear them in the same order. */
export const INBOX_REASONS: readonly InboxReason[] = ["assigned", "author", "awaiting"];

/** One row: an entity, and every answer it came back in. */
export type InboxItem =
  | { kind: "issue"; id: string; reasons: InboxReason[]; entity: IssueListItemFragment }
  | { kind: "pr"; id: string; reasons: InboxReason[]; entity: PrListItemFragment };

/** One answer, and the question it answered. */
export interface InboxGroup<T> {
  reason: InboxReason;
  entities: readonly T[];
}

export interface InboxAnswers {
  issues: readonly InboxGroup<IssueListItemFragment>[];
  prs: readonly InboxGroup<PrListItemFragment>[];
}

/**
 * A row as the comparators read it.
 *
 * A pull request carries neither key, so `rank` and `deadline` are left
 * undefined and every order puts it after the work that was scheduled — which
 * is what `nullsLast` already does for an issue nobody has placed.
 */
export function sortableOf(item: InboxItem): Sortable {
  if (item.kind === "pr") return { id: item.id, created: item.entity.created };
  return {
    id: item.id,
    created: item.entity.created,
    rank: item.entity.rank,
    deadline: item.entity.deadline,
  };
}

/** The inbox in one of the orders of spec 02 §2.5. */
export function sortInbox(items: readonly InboxItem[], order: SortOrder): InboxItem[] {
  const compare = compareBy(order);
  return [...items].sort((a, b) => compare(sortableOf(a), sortableOf(b)));
}

/**
 * Every answer as one list: each entity once, carrying every reason it has.
 *
 * An entity can honestly come back in several answers — a pull request you
 * opened and were then asked to review — and it is one thing to do, so it is
 * one row. Two entities of different kinds could in principle share an id, so
 * the kind is part of what makes a row the same row.
 */
export function mergeInbox(answers: InboxAnswers): InboxItem[] {
  const byKey = new Map<string, InboxItem>();

  const add = (item: InboxItem): void => {
    const key = `${item.kind}:${item.id}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, item);
      return;
    }
    for (const reason of item.reasons) {
      if (!seen.reasons.includes(reason)) seen.reasons.push(reason);
    }
    seen.reasons.sort((a, b) => INBOX_REASONS.indexOf(a) - INBOX_REASONS.indexOf(b));
  };

  for (const group of answers.issues) {
    for (const entity of group.entities) {
      add({ kind: "issue", id: entity.id, reasons: [group.reason], entity });
    }
  }
  for (const group of answers.prs) {
    for (const entity of group.entities) {
      add({ kind: "pr", id: entity.id, reasons: [group.reason], entity });
    }
  }

  return [...byKey.values()];
}

/* ------------------------------------------------------------------ narrow */

/** The rail's first group: which reason, or all of them. */
export type InboxView = "everything" | "assigned" | "authored" | "reviews";
/** Its second: which kind, or both. */
export type InboxKindChoice = "any" | InboxKind;

export const INBOX_VIEWS: readonly InboxView[] = ["everything", "assigned", "authored", "reviews"];
export const INBOX_KIND_CHOICES: readonly InboxKindChoice[] = ["any", "issue", "pr"];

/** A view names a reason; "everything" names none and keeps every row. */
const VIEW_REASON: Record<Exclude<InboxView, "everything">, InboxReason> = {
  assigned: "assigned",
  authored: "author",
  reviews: "awaiting",
};

export interface InboxSelection {
  view: InboxView;
  kind: InboxKindChoice;
  /**
   * What is chosen in each group a plugin layer added, by group key.
   *
   * Null, or an absent key, is that group's "any" — so an inbox with no
   * plugins loaded is `{}` and every function here ignores the whole idea.
   */
  ext: Record<string, string | null>;
}

/**
 * A way of grouping the inbox that a plugin layer registered.
 *
 * A module-level array rather than something read from the slot registry, for
 * the reason `FILTER_EXTENSIONS` is one: everything in this file is a pure
 * function over a list of items and has to stay unit-testable without mounting
 * an app. A layer's Nuxt plugin registers into the slots, and the slots push
 * here.
 */
export interface InboxGrouping {
  /** The key it is chosen under, in the selection and in the URL. */
  key: string;
  /** Its heading in the rail. */
  label: string;
  /** The values present among these items, in the order to offer them. */
  values: (items: readonly InboxItem[]) => string[];
  matches: (item: InboxItem, value: string) => boolean;
}

export const INBOX_GROUPINGS: InboxGrouping[] = [];

/** Register a plugin's grouping. Called by the slot registry. */
export function registerInboxGrouping(group: InboxGrouping): void {
  if (!INBOX_GROUPINGS.some((entry) => entry.key === group.key)) INBOX_GROUPINGS.push(group);
}

/** Forget every registered grouping. For tests. */
export function resetInboxGroupings(): void {
  INBOX_GROUPINGS.length = 0;
}

export function matchesSelection(item: InboxItem, selection: InboxSelection): boolean {
  if (selection.view !== "everything" && !item.reasons.includes(VIEW_REASON[selection.view])) {
    return false;
  }
  if (selection.kind !== "any" && item.kind !== selection.kind) return false;
  for (const group of INBOX_GROUPINGS) {
    const wanted = selection.ext[group.key] ?? null;
    if (wanted !== null && !group.matches(item, wanted)) return false;
  }
  return true;
}

export function narrowInbox(items: readonly InboxItem[], selection: InboxSelection): InboxItem[] {
  return items.filter((item) => matchesSelection(item, selection));
}

/* ------------------------------------------------------------------ counts */

export interface RailEntry<T> {
  value: T;
  count: number;
}

export interface RailCounts {
  views: RailEntry<InboxView>[];
  kinds: RailEntry<InboxKindChoice>[];
  /**
   * One list per registered group, by key. "Any" first, as a null value, then
   * one entry per value the group offers.
   */
  ext: Record<string, RailEntry<string | null>[]>;
}

/**
 * What each rail entry would show if it were the one chosen.
 *
 * Faceted rather than total: a count beside an entry is a promise about what
 * clicking it shows, and a total taken across the whole inbox would break that
 * promise the moment another group is narrowing. It costs nothing — the whole
 * set is already here — and it says which clicks would empty the list.
 *
 * The values a registered group offers are every value the inbox mentions,
 * narrowed by nothing, plus whichever one is currently chosen. So the rail does
 * not reshuffle under the pointer as other groups are used, and a value chosen
 * from a URL that matches nothing is still there to be taken off — a filter you
 * cannot see is one you cannot remove.
 */
export function railCounts(items: readonly InboxItem[], selection: InboxSelection): RailCounts {
  const countWith = (part: Partial<InboxSelection>): number =>
    items.reduce(
      (total, item) => (matchesSelection(item, { ...selection, ...part }) ? total + 1 : total),
      0,
    );

  const ext: Record<string, RailEntry<string | null>[]> = {};
  for (const group of INBOX_GROUPINGS) {
    const values = group.values(items);
    const chosen = selection.ext[group.key] ?? null;
    // Chosen but carried by nothing here: kept, or the only way to undo it
    // would be to edit the address bar. Whether anything carries it is the
    // group's own question — it may match values the way the format matches a
    // slug, with case folded, and adding `AUTHENTICATION` beside
    // `authentication` would offer one value twice.
    if (chosen !== null && !items.some((item) => group.matches(item, chosen))) {
      values.push(chosen);
      values.sort((a, b) => a.localeCompare(b));
    }
    const entries: RailEntry<string | null>[] = [
      { value: null, count: countWith({ ext: { ...selection.ext, [group.key]: null } }) },
    ];
    for (const value of values) {
      entries.push({
        value,
        count: countWith({ ext: { ...selection.ext, [group.key]: value } }),
      });
    }
    ext[group.key] = entries;
  }

  return {
    views: INBOX_VIEWS.map((view) => ({ value: view, count: countWith({ view }) })),
    kinds: INBOX_KIND_CHOICES.map((kind) => ({ value: kind, count: countWith({ kind }) })),
    ext,
  };
}

/* --------------------------------------------------------------- variables */

/** What the inbox query takes, for one person and one scope. */
export function inboxVariables(
  me: string,
  scope: { finished: boolean; text: string },
): InboxQueryVariables {
  const terms = splitTerms(scope.text);
  // Null rather than an absent key: the server reads either as no narrowing,
  // and a variables object of one shape keeps Apollo watching one query.
  return { me, finished: scope.finished, text: terms.length > 0 ? terms : null };
}
