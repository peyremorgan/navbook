<!--
  Labels, assignees or a milestone.

  Creatable, and offering whatever the listing had in it, because there is no
  registry to offer instead: the format keeps none and the server introduces
  none (spec 06 §6.6). Anything you type is a valid value.
-->
<script setup lang="ts">
const props = defineProps<{
  title: string;
  icon: string;
  values: string[];
  suggestions: string[];
  single?: boolean;
  testid: string;
  saving?: boolean;
}>();

const emit = defineEmits<{ save: [string[]] }>();

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
        Only the first is kept; the field holds one value.
      </p>
    </template>

    <div v-else-if="props.values.length" class="flex flex-wrap gap-1">
      <UBadge
        v-for="value in props.values"
        :key="value"
        color="neutral"
        variant="subtle"
        size="sm"
      >
        {{ value }}
      </UBadge>
    </div>
    <p v-else class="text-sm text-muted">None</p>
  </section>
</template>
