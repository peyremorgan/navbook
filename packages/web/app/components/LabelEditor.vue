<!--
  Labels, assignees, a milestone, or the features an entity belongs to.

  Creatable, and offering whatever the listing had in it, because for most of
  these there is no registry to offer instead: the format keeps none and the
  server introduces none (spec 06 §6.6). Anything you type is a valid value.

  Features are the exception, and `linkTo` is how that shows: they are real
  directories with a page of their own, so their chips lead somewhere.

  What it shows when it is not being edited can be replaced through the
  `display` slot, for a field whose reading is richer than its list of values.
-->
<script setup lang="ts">
const props = defineProps<{
  title: string;
  icon: string;
  values: string[];
  suggestions: string[];
  single?: boolean;
  /** Route prefix that makes each chip a link, e.g. `/features/`. */
  linkTo?: string;
  testid: string;
  saving?: boolean;
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
</script>

<template>
  <section class="space-y-1.5" :data-testid="`sidebar-${props.testid}`">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <UIcon :name="props.icon" class="size-3.5" />{{ props.title }}
      </h3>
      <UButton
        v-if="!editing"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        :aria-label="`Edit ${props.title.toLowerCase()}`"
        :data-testid="`edit-${props.testid}`"
        @click="open"
      />
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
          :loading="props.saving"
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
  </section>
</template>
