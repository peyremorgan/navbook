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
import { type InboxItem, registerInboxGrouping, resetInboxGroupings } from "~/utils/inbox";
import { registerPatchField, resetPatchFields } from "~/utils/patch";

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
 * Given the entity as the page shows it — pending edits already laid over it —
 * whether any save is in flight, and the `FieldSave` that covers plugin
 * fields, so a panel's spinner, refusal and Retry read exactly as a built-in
 * editor's do. It emits `save` with a `Partial<EntityEdit>`, and a plugin's
 * values go in `ext` under the field name its SDL added
 * ({@link EntityFieldSlot}).
 *
 * It is also given `disabled`, set when the server has already said it cannot
 * take a write to this entity — a pull request whose branch this checkout
 * does not hold — and a panel that edits withdraws its offer to, as the
 * built-in editors beside it do. A panel must declare it even if it only
 * reads: a prop a component does not declare lands on its root element.
 *
 * Kept to one shape for issues and pull requests, because a plugin that has
 * something to say about one usually has the same thing to say about the
 * other.
 */
export interface PanelSlot {
  noun: "issue" | "pr";
  component: Component;
  order?: number;
}

/**
 * A field this plugin's SDL added to `UpdateIssueInput` / `UpdatePrInput`.
 *
 * Registering it is what lets the host build a patch naming it, and what gives
 * a refused edit a name a person recognises. `read` is how its current value
 * is found on an entity: `Entity.ext` is keyed by plugin short name, and only
 * the plugin knows what it put there.
 */
export interface EntityFieldSlot {
  /** The input field, e.g. `features`. */
  field: string;
  /** What it is called on the page, for the refused-edit alert. */
  label: string;
  /** Its current value, read off `Entity.ext`. */
  read: (ext: Record<string, unknown>) => string[];
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
  /** The field the plugin's SDL added to the API's `IssueFilter` and `PrFilter`. */
  apiField: string;
  label: string;
  icon: string;
  nouns: ("issue" | "pr")[];
  /** The values to offer; called when the menu opens. */
  options: () => string[];
}

/**
 * A badge on a row in a listing, beside the labels.
 *
 * Given the entity the row drew and `where` — a short name for the listing it
 * is in, `issue` or `inbox-row` — because the same badge is placed differently
 * in each and an end-to-end test finds it by a name that says which.
 */
export interface RowBadgeSlot {
  component: Component;
  order?: number;
}

/**
 * A way of grouping the inbox, beside the built-in ones.
 *
 * `key` is both the field in the selection and the query parameter, so a
 * grouped inbox is an address somebody can send. `label` heads the group and
 * names its "Any" entry, and `icon` is a Lucide name as the built-in groups
 * use.
 */
export interface InboxGroupSlot {
  key: string;
  label: string;
  icon: string;
  /** The values present among these items, in the order to offer them. */
  values: (items: readonly InboxItem[]) => string[];
  matches: (item: InboxItem, value: string) => boolean;
}

/**
 * How Apollo should cache the types and root fields this plugin's SDL added.
 *
 * The host's cache configuration names the types it knows about, and a type it
 * cannot key is normalised badly rather than loudly — two reads of one feature
 * becoming two objects, and a write to one leaving the other showing the old
 * value. `keyArgs` is the same problem for a root field: without it, a query
 * for one argument is answered from the cache of another.
 *
 * Both maps are passed to Apollo as they are.
 */
export interface CacheSlot {
  /** By type name, e.g. `{ Feature: { keyFields: ["slug"] } }`. */
  typePolicies?: Record<string, { keyFields: string[] | false }>;
  /** By root query field, e.g. `{ feature: { keyArgs: ["slug"] } }`. */
  queryFields?: Record<string, { keyArgs: string[] | false }>;
}

/** What a layer may register. */
export interface SlotRegistration {
  navLinks?: NavLinkSlot[];
  panels?: PanelSlot[];
  entityFields?: EntityFieldSlot[];
  formFields?: FormFieldSlot[];
  filters?: FilterSlot[];
  rowBadges?: RowBadgeSlot[];
  inboxGroups?: InboxGroupSlot[];
  cache?: CacheSlot;
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
  entityFields: EntityFieldSlot[];
  formFields: FormFieldSlot[];
  filters: FilterSlot[];
  rowBadges: RowBadgeSlot[];
  inboxGroups: InboxGroupSlot[];
  cache: CacheSlot[];
  listings: string[];
}

const slots: Slots = {
  navLinks: [],
  panels: [],
  entityFields: [],
  formFields: [],
  filters: [],
  rowBadges: [],
  inboxGroups: [],
  cache: [],
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
    entityFields: () => [...slots.entityFields],
    formFields: (form: "issue-new") =>
      byOrder(slots.formFields.filter((slot) => slot.form === form)),
    filters: (noun: "issue" | "pr") => slots.filters.filter((slot) => slot.nouns.includes(noun)),
    rowBadges: () => byOrder(slots.rowBadges),
    inboxGroups: () => [...slots.inboxGroups],
    /** Every registered type policy, merged into one map for Apollo. */
    typePolicies: () =>
      Object.assign({}, ...slots.cache.map((entry) => entry.typePolicies ?? {})) as Record<
        string,
        { keyFields: string[] | false }
      >,
    /** Every registered root-field policy, merged the same way. */
    queryFields: () =>
      Object.assign({}, ...slots.cache.map((entry) => entry.queryFields ?? {})) as Record<
        string,
        { keyArgs: string[] | false }
      >,
    listings: () => [...slots.listings],

    /** Called by a layer's own Nuxt plugin, before the first render. */
    register(registration: SlotRegistration): void {
      for (const link of registration.navLinks ?? []) slots.navLinks.push(link);
      for (const panel of registration.panels ?? []) slots.panels.push(panel);
      for (const entityField of registration.entityFields ?? []) {
        slots.entityFields.push(entityField);
        // The pure patch builder keeps its own list, so it stays testable
        // without an app; this is the one place the two are kept in step.
        registerPatchField(entityField.field, entityField.label);
      }
      for (const field of registration.formFields ?? []) slots.formFields.push(field);
      for (const filter of registration.filters ?? []) {
        slots.filters.push(filter);
        // The pure filter functions keep their own list, so they stay testable
        // without an app; this is the one place the two are kept in step.
        registerFilterParam(filter.param, filter.apiField);
      }
      for (const badge of registration.rowBadges ?? []) slots.rowBadges.push(badge);
      for (const group of registration.inboxGroups ?? []) {
        slots.inboxGroups.push(group);
        registerInboxGrouping(group);
      }
      if (registration.cache !== undefined) slots.cache.push(registration.cache);
      for (const listing of registration.listings ?? []) {
        if (!slots.listings.includes(listing)) slots.listings.push(listing);
      }
    },
  };
}

/** Empty every slot. For tests, which would otherwise leak across cases. */
export function resetNavbookSlots(): void {
  resetFilterParams();
  resetInboxGroupings();
  resetPatchFields();
  slots.navLinks.length = 0;
  slots.panels.length = 0;
  slots.entityFields.length = 0;
  slots.formFields.length = 0;
  slots.filters.length = 0;
  slots.rowBadges.length = 0;
  slots.inboxGroups.length = 0;
  slots.cache.length = 0;
  slots.listings.length = 0;
}
