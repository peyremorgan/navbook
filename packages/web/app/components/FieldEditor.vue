<!--
  One scalar field, edited in place: a rank or a deadline.

  `LabelEditor` beside it does the same job for the fields that hold a list of
  words, and this one exists because these two hold neither a list nor a word.
  A rank is a number and a deadline is a day, and both are better served by the
  input the browser already has for them — a spinner and a date picker — than by
  a creatable menu offering values from a listing.

  Blank means no value, which is how the field is cleared. The patch builder is
  what turns that into the explicit null the mutation wants, and what refuses a
  value that is not a number or not a day; nothing here validates, so there is
  one place that decides what those words mean.
-->
<script setup lang="ts">
const props = defineProps<{
  title: string;
  icon: string;
  type: "number" | "date";
  /** The value as the input holds it; blank when there is none. */
  value: string;
  /** What the read-only half says when the value is blank. */
  placeholder?: string;
  testid: string;
  saving?: boolean;
}>();

const emit = defineEmits<{ save: [string] }>();

const editing = ref(false);
const draft = ref(props.value);

watch(
  () => props.value,
  (next) => {
    if (!editing.value) draft.value = next;
  },
);

function open(): void {
  draft.value = props.value;
  editing.value = true;
}

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
      <UInput
        v-model="draft"
        :type="props.type"
        :step="props.type === 'number' ? 'any' : undefined"
        class="w-full"
        :aria-label="props.title"
        :data-testid="`input-${props.testid}`"
        @keydown.enter="save"
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
      <p class="text-xs text-muted">Leave it blank to remove it.</p>
    </template>

    <!-- A deadline reads better as "due in 3 days" than as a date. -->
    <slot v-else-if="$slots.display && props.value !== ''" name="display" />
    <p v-else-if="props.value !== ''" class="text-sm">{{ props.value }}</p>
    <p v-else class="text-sm text-muted">{{ props.placeholder ?? "None" }}</p>
  </section>
</template>
