<!--
  Labels, assignees, a milestone, or the features an entity belongs to.

  Creatable whatever it is offering. For labels and milestones there is no
  registry to offer instead — the format keeps none and the server introduces
  none (spec 06 §6.6) — so the suggestions are whatever the listing had in it.
  For a field naming a person the server does answer, from its history and its
  tree, but that reading is derived rather than authoritative and an address it
  has never seen is still a valid one. Anything you type is a valid value.

  Features are the exception that shows: they are real directories with a page
  of their own, which is what `linkTo` is for — their chips lead somewhere.

  What it shows when it is not being edited can be replaced through the
  `display` slot, for a field whose reading is richer than its list of values.

  `self` is the signed-in person, spelled the way this repository spells them
  (`useViewerField`). A field given one grows a second button that puts them on
  the list, or takes them off it again when they are already on it — the whole
  point being that the commonest value of a field that names a person is the
  person reading it, and searching a directory of everybody for your own name
  is a poor way to say "mine". It saves through the same emit as the editor
  below it, so a save in flight, a refusal and a stale edit read identically.

  `disabled` withdraws the offer to edit, for the one case where the server has
  already said it cannot take the write: a pull request whose branch this
  checkout does not hold. Letting somebody type a second thing that will be
  refused the same way is not better than not offering.

  Saving closes the editor at once, so `values` is expected to already say
  what was saved — the page overlays the pending edit — and `save` is where
  the wait and any refusal are read from (`usePendingEdits`).
-->
<script setup lang="ts">
import type { FieldSave } from "~/composables/usePendingEdits";

const props = defineProps<{
  title: string;
  icon: string;
  values: string[];
  suggestions: string[];
  single?: boolean;
  /** Route prefix that makes each chip a link, e.g. `/features/`. */
  linkTo?: string;
  testid: string;
  /** The viewer, spelled as this field spells people; enables the quick toggle. */
  self?: string | null;
  /** The field's save in flight or refused, shown beneath the values. */
  save?: FieldSave;
  /** Set when this cannot be written at all; the field reads but does not offer. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ save: [string[]] }>();

// Resolved rather than named as a string: `<component is="NuxtLink">` finds
// nothing in a built bundle, where auto-imported components are not registered
// globally, and the chip silently stops being a link.
const Link = resolveComponent("NuxtLink");

const editing = ref(false);
const draft = ref<string[]>([...props.values]);

watch(
  () => props.values,
  (next) => {
    if (!editing.value) draft.value = [...next];
  },
);

function open(): void {
  draft.value = [...props.values];
  editing.value = true;
}

// A milestone is one string on disk, so choosing a second replaces the first
// rather than being quietly dropped when the patch is built.
watch(draft, (next) => {
  if (props.single === true && next.length > 1) draft.value = next.slice(-1);
});

function save(): void {
  emit("save", draft.value);
  editing.value = false;
}

/** Whether the viewer is already on the list, by address rather than spelling. */
const mine = computed(
  () =>
    props.self !== null &&
    props.self !== undefined &&
    findPerson(props.values, props.self) !== undefined,
);

/*
 * The toggle saves against `values` rather than against the draft: it is
 * offered while the editor is closed, so `values` is the whole truth, and the
 * page overlays what this sends before the server answers.
 */
function toggleSelf(): void {
  if (props.self === null || props.self === undefined) return;
  emit("save", togglePerson(props.values, props.self));
}
</script>

<template>
  <section class="space-y-1.5" :data-testid="`sidebar-${props.testid}`">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <UIcon :name="props.icon" class="size-3.5" />{{ props.title }}
      </h3>
      <div class="flex items-center">
        <UButton
          v-if="!editing && !props.disabled && props.self"
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="mine ? 'i-lucide-user-minus' : 'i-lucide-user-plus'"
          :aria-label="`${mine ? 'Remove yourself from' : 'Add yourself to'} ${props.title.toLowerCase()}`"
          :title="`${mine ? 'Remove yourself from' : 'Add yourself to'} ${props.title.toLowerCase()}`"
          :loading="props.save?.saving"
          :data-testid="`self-${props.testid}`"
          @click="toggleSelf"
        />
        <UButton
          v-if="!editing && !props.disabled"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-pencil"
          :aria-label="`Edit ${props.title.toLowerCase()}`"
          :data-testid="`edit-${props.testid}`"
          @click="open"
        />
      </div>
    </div>

    <template v-if="editing">
      <CreatableSelect
        v-model="draft"
        :suggestions="props.suggestions"
        :testid="`input-${props.testid}`"
      />
      <div class="flex gap-1.5">
        <UButton
          size="xs"
          :loading="props.save?.saving"
          :data-testid="`save-${props.testid}`"
          @click="save"
        >
          Save
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" @click="editing = false">Cancel</UButton>
      </div>
      <p v-if="props.single" class="text-xs text-muted">
        One value: choosing another replaces it.
      </p>
    </template>

    <!--
      The read-only half is replaceable, because one field needs to show more
      than the values it edits: the reviewers panel lists what each person said
      about the latest revision, which is derived and so is not what a save
      sends back (spec 02 §2.7).
    -->
    <slot v-else-if="$slots.display" name="display" />

    <div v-else-if="props.values.length" class="flex flex-wrap gap-1">
      <component
        :is="props.linkTo ? Link : 'span'"
        v-for="value in props.values"
        :key="value"
        :to="props.linkTo ? `${props.linkTo}${value}` : undefined"
        :data-testid="`chip-${props.testid}-${value}`"
      >
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
          :class="props.linkTo ? 'hover:bg-elevated' : undefined"
        >
          {{ value }}
        </UBadge>
      </component>
    </div>
    <p v-else class="text-sm text-muted">None</p>

    <SaveStatus v-if="props.save" :save="props.save" :testid="props.testid" />
  </section>
</template>
