<!--
  A menu of values that also accepts one it has never heard of.

  Every list this client edits or filters on is free text: the format keeps no
  registry of labels or milestones and the server introduces none (spec 06
  §6.6), so those suggestions are whatever the listing on screen happens to
  contain. People are the one kind the server can enumerate, from its history
  and its tree — but that list is derived rather than authoritative, and the
  format would take an address found in neither. So this stays creatable
  whatever it is offering: anything typed is as valid as anything offered.

  `USelectMenu`'s `create-item` announces a new value rather than adopting it,
  because the component cannot know where the caller keeps its options. So this
  wrapper does both — remembers it for the rest of the session, and selects it —
  which is what "creatable" means to the person typing, and it is wanted in
  three places identically.
-->
<script setup lang="ts">
const props = defineProps<{
  /** What is on offer: a listing's values, or a list the server derived. */
  suggestions: readonly string[];
  placeholder?: string;
  icon?: string;
  size?: "xs" | "sm" | "md";
  testid?: string;
}>();

const model = defineModel<string[]>({ required: true });

/** Values typed here that nothing offered; kept so they stay selectable. */
const invented = ref<string[]>([]);

const items = computed(() => [
  ...new Set([...props.suggestions, ...invented.value, ...model.value]),
]);

function create(value: string): void {
  const trimmed = value.trim();
  if (trimmed === "") return;
  if (!invented.value.includes(trimmed)) invented.value.push(trimmed);
  if (!model.value.includes(trimmed)) model.value = [...model.value, trimmed];
}
</script>

<template>
  <USelectMenu
    v-model="model"
    :items="items"
    multiple
    create-item
    :icon="props.icon"
    :size="props.size ?? 'sm'"
    :placeholder="props.placeholder"
    class="w-full"
    :data-testid="props.testid"
    @create="create"
  />
</template>
