<!--
  A field you edit in place.

  Saving emits the new value and nothing else; whether it is a change at all is
  `buildEntityPatch`'s question, and an edit that changed nothing must not be
  sent — the mutation refuses an empty patch, and rightly.

  `disabled` withdraws the offer to edit, as it does on `LabelEditor`, for the
  one case where the server has already said it cannot take the write: a pull
  request whose branch this checkout does not hold.
-->
<script setup lang="ts">
const props = defineProps<{
  value: string;
  label: string;
  multiline?: boolean;
  saving?: boolean;
  testid?: string;
  /** The format needs a title and the server refuses an empty body. */
  required?: boolean;
  /** Set when this cannot be written at all; the field reads but does not offer. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ save: [string] }>();

const editing = ref(false);
const draft = ref(props.value);
const problem = ref<string | null>(null);

watch(
  () => props.value,
  (next) => {
    if (!editing.value) draft.value = next;
  },
);

function open(): void {
  draft.value = props.value;
  problem.value = null;
  editing.value = true;
}

function cancel(): void {
  draft.value = props.value;
  problem.value = null;
  editing.value = false;
}

function save(): void {
  // Said here rather than in a toast, and the editor stays open: a message
  // that appears while the words it is about have already been discarded is
  // not much of a message.
  if (props.required === true && draft.value.trim() === "") {
    problem.value = `a ${props.label} is required`;
    return;
  }
  problem.value = null;
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
        v-if="!props.disabled"
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
      <p v-if="problem" class="text-sm text-error" :data-testid="props.testid ? `error-${props.testid}` : undefined">
        {{ problem }}
      </p>
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
