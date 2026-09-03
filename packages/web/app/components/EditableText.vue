<!--
  A field you edit in place.

  Saving emits the new value and nothing else; whether it is a change at all is
  `buildIssuePatch`'s question, and an edit that changed nothing must not be
  sent — the mutation refuses an empty patch, and rightly.
-->
<script setup lang="ts">
const props = defineProps<{
  value: string;
  label: string;
  multiline?: boolean;
  saving?: boolean;
  testid?: string;
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

function cancel(): void {
  draft.value = props.value;
  editing.value = false;
}

function save(): void {
  emit("save", draft.value);
  editing.value = false;
}
</script>

<template>
  <div>
    <div v-if="!editing" class="group flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <slot />
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        :aria-label="`Edit the ${props.label}`"
        :data-testid="props.testid ? `edit-${props.testid}` : undefined"
        @click="open"
      />
    </div>

    <div v-else class="space-y-2">
      <UTextarea
        v-if="props.multiline"
        v-model="draft"
        :rows="10"
        autoresize
        class="w-full"
        :aria-label="props.label"
        :data-testid="props.testid ? `input-${props.testid}` : undefined"
      />
      <UInput
        v-else
        v-model="draft"
        class="w-full"
        :aria-label="props.label"
        :data-testid="props.testid ? `input-${props.testid}` : undefined"
        @keydown.enter="save"
        @keydown.esc="cancel"
      />
      <div class="flex gap-2">
        <UButton
          size="sm"
          :loading="props.saving"
          :data-testid="props.testid ? `save-${props.testid}` : undefined"
          @click="save"
        >
          Save
        </UButton>
        <UButton size="sm" color="neutral" variant="ghost" @click="cancel">Cancel</UButton>
      </div>
    </div>
  </div>
</template>
