<!--
  What a field's save is doing, said beside the field.

  Two things, and usually neither. "Saving…" appears only once a write has
  been out long enough to wonder about (`SLOW_SAVE_MS`): on a responsive
  backend it never shows at all, which is the point — a spinner that flashes
  on every save is noise, and one that appears after a couple of seconds is
  information. It blocks nothing; the field can be edited again meanwhile.

  A refusal is kept with the value it tried to set, which the field is still
  showing, and offers the two answers a person can give it: send it again, or
  drop it and show what the file says. The server's own sentence is quoted,
  because it names the branch, the remote or the conflict, and nothing written
  here could say it better.
-->
<script setup lang="ts">
import type { FieldSave } from "~/composables/usePendingEdits";

const props = defineProps<{
  save: FieldSave;
  testid?: string;
}>();

const id = (prefix: string): string | undefined =>
  props.testid ? `${prefix}-${props.testid}` : undefined;
</script>

<template>
  <div v-if="props.save.slow || props.save.failure" class="space-y-1.5">
    <p
      v-if="props.save.slow"
      class="inline-flex items-center gap-1 text-xs text-muted"
      aria-live="polite"
      :data-testid="id('saving')"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
      Saving…
    </p>

    <div
      v-if="props.save.failure"
      role="alert"
      class="space-y-1.5 rounded-md border border-error/40 bg-error/5 px-2.5 py-2 text-xs"
      :data-testid="id('save-failed')"
    >
      <p class="font-medium text-error">{{ props.save.failure.heading }}</p>
      <p class="text-muted">
        {{ props.save.failure.message }}. What you saved is shown here and is not in the file.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <UButton
          size="xs"
          color="error"
          variant="subtle"
          icon="i-lucide-rotate-cw"
          :data-testid="id('retry')"
          @click="props.save.retry()"
        >
          Retry
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :data-testid="id('discard')"
          @click="props.save.discard()"
        >
          Discard
        </UButton>
      </div>
    </div>
  </div>
</template>
