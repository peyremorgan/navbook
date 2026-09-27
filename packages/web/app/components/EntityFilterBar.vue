<!--
  The filter, as controls.

  What the menus offer is passed in, and comes from one of two places. Labels
  and milestones are read off the listing currently on screen, because there is
  nowhere else they could come from: the format keeps no registry of them and
  the server introduces none (spec 06 §6.6). People are a registry the server
  can answer — its own reading of its history and tree — so that menu is
  offered the actual list. Every menu is creatable either way: you can filter by
  a label no visible entity carries, or by somebody the repository has not heard
  of. A menu a plugin layer registered comes last and brings its own values
  (`useNavbookSlots`).

  Status is chips rather than a menu because there are only ever two or three to
  choose from and it is the filter reached for most. Like every other control
  here, none selected means no narrowing: entities of every status are listed.

  Wide, the bar is three rows: the search box beside the chips, the five menus
  sharing one line in equal parts, then Clear. Equal parts rather than each menu
  sized to what it holds, because a menu's width would then change with every
  value picked and the row would reflow under the pointer. A long selection is
  truncated instead, and the menu says it in full when opened.

  Narrow, those five menus are behind a toggle. Stacked they are five lines of
  controls above the listing — most of a phone — and what is reached for on a
  phone is a status chip or a word in the box. The panel opens itself whenever
  something is narrowing by a menu, since a filter you cannot see is one you
  cannot take off, and it counts what is chosen while it is shut. It is hidden
  with CSS rather than taken away, so the same controls exist at every width and
  a resize needs nothing done about it; whether it is open belongs to this bar
  alone and is remembered nowhere.
-->
<script setup lang="ts">
import { statusLabel } from "~/utils/entities";
import type { FilterState } from "~/utils/filter-params";
import type { DeadlineState, Status } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  filter: FilterState;
  statuses: readonly Status[];
  /** Absent for pull requests, which are not scheduled (spec 02 §2.5). */
  deadlines?: readonly DeadlineState[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  /** Absent for issues, which have no reviewers (spec 02 §2.7). */
  reviewers?: string[];
  /** Which listing this is, so a plugin's menus can be the ones it offers. */
  noun: "issue" | "pr";
  empty: boolean;
}>();

const slots = useNavbookSlots();

const emit = defineEmits<{ patch: [Partial<FilterState>]; clear: [] }>();

function statusActive(status: Status): boolean {
  return props.filter.status.includes(status);
}

function toggleStatus(status: Status): void {
  const selected = props.filter.status;
  emit("patch", {
    status: statusActive(status)
      ? selected.filter((item) => item !== status)
      : [...selected, status],
  });
}

/** What each deadline chip says; the enum's own words are not the reader's. */
const DEADLINE_LABEL: Record<DeadlineState, string> = {
  OVERDUE: "Overdue",
  NONE: "No deadline",
};

function deadlineActive(state: DeadlineState): boolean {
  return props.filter.deadline.includes(state);
}

function toggleDeadline(state: DeadlineState): void {
  const selected = props.filter.deadline;
  emit("patch", {
    deadline: deadlineActive(state)
      ? selected.filter((item) => item !== state)
      : [...selected, state],
  });
}

/**
 * One menu: where it reads from and what choosing in it means.
 *
 * `values` and `patch` rather than a key into `FilterState`, because a plugin's
 * menu is not a key of it — its values live in `filter.ext` under the parameter
 * its layer registered. Naming both explicitly keeps one template over the two
 * kinds, so a plugin's menu behaves and looks exactly like a built-in one.
 */
interface FilterMenu {
  key: string;
  label: string;
  icon: string;
  options: string[];
  values: string[];
  patch: (values: string[]) => Partial<FilterState>;
}

/** A menu over one of this filter's own list-valued keys. */
function ownMenu(
  key: "labels" | "assignees" | "authors" | "milestones" | "reviewers",
  label: string,
  icon: string,
  options: string[],
): FilterMenu {
  return {
    key,
    label,
    icon,
    options,
    values: props.filter[key] ?? [],
    patch: (values) => ({ [key]: values }),
  };
}

const menus = computed<FilterMenu[]>(() => [
  ownMenu("labels", "Label", "i-lucide-tag", props.labels),
  ownMenu("assignees", "Assignee", "i-lucide-user", props.assignees),
  ownMenu("authors", "Author", "i-lucide-pen-line", props.authors),
  ownMenu("milestones", "Milestone", "i-lucide-flag", props.milestones),
  // Only where the noun has one: an issue is never reviewed, and the API
  // refuses the term rather than matching nothing.
  ...(props.reviewers === undefined
    ? []
    : [ownMenu("reviewers", "Reviewer", "i-lucide-eye", props.reviewers)]),
  // Last, so a plugin's menu never moves one of the format's own.
  ...slots.filters(props.noun).map(
    (slot): FilterMenu => ({
      key: slot.param,
      label: slot.label,
      icon: slot.icon,
      options: slot.options(),
      values: props.filter.ext[slot.param] ?? [],
      // The whole map, so two plugins' menus do not clear each other.
      patch: (values) => ({ ext: { ...props.filter.ext, [slot.param]: values } }),
    }),
  ),
]);

/** Values chosen across the menus, which is what the shut toggle reports. */
const menuCount = computed(() =>
  menus.value.reduce((count, menu) => count + menu.values.length, 0),
);

/** Whether the menus are shown. Above `md` they always are, and this is idle. */
const menusShown = ref(menuCount.value > 0);

// What is true at the start is true later: above `md` the menus are always
// there, so a window narrowed after one has been used would otherwise hide the
// filter it is applying. It only ever opens — shutting the panel under somebody
// who has just emptied its last menu would take away the control they emptied
// it with.
watch(menuCount, (next, previous) => {
  if (previous === 0 && next > 0) menusShown.value = true;
});

// Both listings can be alive at once across a route change, so these are minted
// rather than written down.
const toggleId = useId();
const menusId = useId();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <SearchBox
        :text="props.filter.text"
        testid="filter-text"
        class="w-full md:w-auto md:min-w-56 md:flex-1"
        @commit="(text: string) => emit('patch', { text })"
      />

      <div class="flex items-center gap-1" role="group" aria-label="Status">
        <UButton
          v-for="status in props.statuses"
          :key="status"
          size="sm"
          color="neutral"
          :variant="statusActive(status) ? 'soft' : 'ghost'"
          :aria-pressed="statusActive(status)"
          :data-testid="`filter-status-${status.toLowerCase()}`"
          @click="toggleStatus(status)"
        >
          {{ statusLabel(status) }}
        </UButton>
      </div>

      <!--
        Chips beside the status ones, and for the same reasons: there are two,
        they are reached for often, and none selected means no narrowing. Only
        an issue has a deadline, so the group is absent rather than empty on the
        pull request listing.
      -->
      <div
        v-if="props.deadlines?.length"
        class="flex items-center gap-1"
        role="group"
        aria-label="Deadline"
      >
        <UButton
          v-for="state in props.deadlines"
          :key="state"
          size="sm"
          color="neutral"
          :variant="deadlineActive(state) ? 'soft' : 'ghost'"
          :aria-pressed="deadlineActive(state)"
          :data-testid="`filter-deadline-${state.toLowerCase()}`"
          @click="toggleDeadline(state)"
        >
          {{ DEADLINE_LABEL[state] }}
        </UButton>
      </div>

      <UButton
        size="sm"
        color="neutral"
        variant="ghost"
        class="ms-auto md:hidden"
        :trailing-icon="menusShown ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="menusShown"
        :aria-controls="menusId"
        data-testid="filter-advanced"
        @click="menusShown = !menusShown"
      >
        <span :id="toggleId">Advanced search</span>
        <template v-if="menuCount > 0">
          <UBadge color="neutral" variant="subtle" size="sm" data-testid="filter-advanced-count">
            {{ menuCount }}
          </UBadge>
          <!-- The number alone says nothing when read out rather than seen. -->
          <span class="sr-only">chosen</span>
        </template>
      </UButton>
    </div>

    <div
      :id="menusId"
      role="group"
      :aria-labelledby="toggleId"
      class="gap-2 md:grid-cols-5"
      :class="menusShown ? 'grid' : 'hidden md:grid'"
    >
      <CreatableSelect
        v-for="menu in menus"
        :key="menu.key"
        :model-value="menu.values"
        :suggestions="menu.options"
        :icon="menu.icon"
        :placeholder="menu.label"
        class="min-w-0"
        :testid="`filter-${menu.key}`"
        @update:model-value="(value: string[]) => emit('patch', menu.patch(value))"
      />
    </div>

    <UButton
      v-if="!props.empty"
      size="sm"
      color="neutral"
      variant="ghost"
      icon="i-lucide-filter-x"
      class="self-start"
      data-testid="filter-clear"
      @click="emit('clear')"
    >
      Clear
    </UButton>
  </div>
</template>
