/**
 * Where a plugin's web parts appear — spec 02 §2.12, 06 §6.3.
 *
 * A plugin's `./web` export is a Nuxt layer, merged into this build
 * (`nuxt.config.ts`). Its pages and components are then compiled in, but
 * nothing yet *shows* them: a page needs a route somebody can reach, and a
 * panel needs a place on somebody else's page. This registry is that place.
 *
 * A layer fills it from one of its own Nuxt plugin files, which run alongside
 * the host's numbered ones and therefore before the first render. The slots
 * are deliberately few and deliberately shaped like what the host already
 * draws: the point is that a plugin's contribution looks like a built-in, not
 * like a bolt-on. Anything a plugin wants that these do not cover is a page of
 * its own, which needs no slot at all.
 *
 * This is module state rather than a Nuxt `useState`, because it is not state:
 * it is what the build contains, fixed before the app mounts and the same for
 * every viewer. Nothing here is reactive for that reason — a slot filled after
 * the first render would be a slot filled too late.
 */

import type { Component } from "vue";
import { registerFilterParam, resetFilterParams } from "~/utils/filter-params";

/** A tab in the header, beside Issues and Pull requests. */
export interface NavLinkSlot {
  label: string;
  to: string;
  /** A Lucide name, as the built-in links use: `i-lucide-layers`. */
  icon: string;
  /** For end-to-end tests to find it by. */
  testid?: string;
  /** Lower sorts first; the built-in links occupy 0 to 100. */
  order?: number;
}

/**
 * A panel on an entity's detail page, below the built-in fields.
 *
 * Given the entity and whether a save is in flight; emits `save` with whatever
 * the host should send. Kept to one shape for issues and pull requests,
 * because a plugin that has something to say about one usually has the same
 * thing to say about the other.
 */
export interface PanelSlot {
  noun: "issue" | "pr";
  component: Component;
  order?: number;
}

/** A field on the new-issue form, whose value joins the mutation's input. */
export interface FormFieldSlot {
  form: "issue-new";
  component: Component;
  order?: number;
}

/** A chip in a listing's filter bar, and the query parameter behind it. */
export interface FilterSlot {
  /** The URL parameter, e.g. `feature`. */
  param: string;
  /** The field on the API's `EntityFilter` the plugin's SDL added. */
  apiField: string;
  label: string;
  icon: string;
  nouns: ("issue" | "pr")[];
  /** The values to offer; called when the menu opens. */
  options: () => string[];
}

/** A badge on a row in a listing, beside the labels. */
export interface RowBadgeSlot {
  component: Component;
  order?: number;
}

/** A way of grouping the inbox, beside the built-in ones. */
export interface InboxGroupSlot {
  key: string;
  label: string;
  /** The values present among these items, in the order to offer them. */
  values: (items: readonly unknown[]) => string[];
  matches: (item: unknown, value: string) => boolean;
}

/** What a layer may register. */
export interface SlotRegistration {
  navLinks?: NavLinkSlot[];
  panels?: PanelSlot[];
  formFields?: FormFieldSlot[];
  filters?: FilterSlot[];
  rowBadges?: RowBadgeSlot[];
  inboxGroups?: InboxGroupSlot[];
  /**
   * Apollo cache fields to evict when a listing should be refetched.
   *
   * A plugin whose data changes when an entity does says so here, so its
   * listing refreshes with everything else rather than going stale until a
   * reload.
   */
  listings?: string[];
}

interface Slots {
  navLinks: NavLinkSlot[];
  panels: PanelSlot[];
  formFields: FormFieldSlot[];
  filters: FilterSlot[];
  rowBadges: RowBadgeSlot[];
  inboxGroups: InboxGroupSlot[];
  listings: string[];
}

const slots: Slots = {
  navLinks: [],
  panels: [],
  formFields: [],
  filters: [],
  rowBadges: [],
  inboxGroups: [],
  listings: [],
};

/** Lower `order` first; anything without one keeps its registration order. */
function byOrder<T extends { order?: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function useNavbookSlots() {
  return {
    navLinks: () => byOrder(slots.navLinks),
    panels: (noun: "issue" | "pr") => byOrder(slots.panels.filter((slot) => slot.noun === noun)),
    formFields: (form: "issue-new") =>
      byOrder(slots.formFields.filter((slot) => slot.form === form)),
    filters: (noun: "issue" | "pr") => slots.filters.filter((slot) => slot.nouns.includes(noun)),
    rowBadges: () => byOrder(slots.rowBadges),
    inboxGroups: () => [...slots.inboxGroups],
    listings: () => [...slots.listings],

    /** Called by a layer's own Nuxt plugin, before the first render. */
    register(registration: SlotRegistration): void {
      for (const link of registration.navLinks ?? []) slots.navLinks.push(link);
      for (const panel of registration.panels ?? []) slots.panels.push(panel);
      for (const field of registration.formFields ?? []) slots.formFields.push(field);
      for (const filter of registration.filters ?? []) {
        slots.filters.push(filter);
        // The pure filter functions keep their own list, so they stay testable
        // without an app; this is the one place the two are kept in step.
        registerFilterParam(filter.param, filter.apiField);
      }
      for (const badge of registration.rowBadges ?? []) slots.rowBadges.push(badge);
      for (const group of registration.inboxGroups ?? []) slots.inboxGroups.push(group);
      for (const listing of registration.listings ?? []) {
        if (!slots.listings.includes(listing)) slots.listings.push(listing);
      }
    },
  };
}

/** Empty every slot. For tests, which would otherwise leak across cases. */
export function resetNavbookSlots(): void {
  resetFilterParams();
  slots.navLinks.length = 0;
  slots.panels.length = 0;
  slots.formFields.length = 0;
  slots.filters.length = 0;
  slots.rowBadges.length = 0;
  slots.inboxGroups.length = 0;
  slots.listings.length = 0;
}
