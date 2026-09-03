<!--
  Writing a comment, or a reply to one.
-->
<script setup lang="ts">
const props = defineProps<{
  replyTo?: string | null;
  replyToAuthor?: string | null;
  saving?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{ submit: [string]; cancelReply: [] }>();

const body = ref("");

function submit(): void {
  const text = body.value.trim();
  if (text === "") return;
  emit("submit", text);
}

/**
 * Emptied by whoever owns the mutation, once it has actually landed.
 *
 * Clearing on submit would be a data loss the moment a write fails — a push
 * the server could not land, a comment on a branch it does not serve — and
 * what was lost is something a person wrote.
 */
defineExpose({ clear: () => (body.value = "") });
</script>

<template>
  <form class="space-y-2" data-testid="comment-form" @submit.prevent="submit">
    <div v-if="props.replyTo" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-reply" class="size-4" />
      <span>
        Replying to
        <PersonLabel v-if="props.replyToAuthor" :person="props.replyToAuthor" />
        <code v-else>#{{ props.replyTo }}</code>
      </span>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        data-testid="cancel-reply"
        @click="emit('cancelReply')"
      />
    </div>

    <UTextarea
      v-model="body"
      :rows="4"
      autoresize
      class="w-full"
      aria-label="Comment"
      data-testid="comment-body"
      :placeholder="props.placeholder ?? 'Leave a comment. Markdown is rendered.'"
    />
    <UButton
      type="submit"
      size="sm"
      :disabled="body.trim() === ''"
      :loading="props.saving"
      data-testid="comment-submit"
    >
      Comment
    </UButton>
  </form>
</template>
