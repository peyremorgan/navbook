<!--
  The question asked before a navigation throws away unsaved work.

  Staying is the default and every way of closing the dialog means it — Escape,
  the overlay, the close button — because the one answer that cannot be taken
  back is leaving. See `app/plugins/04.unsaved.ts`.
-->
<script setup lang="ts">
const { $unsaved } = useNuxtApp();

const open = computed({
  get: () => $unsaved.asking.value,
  set: (value: boolean) => {
    if (!value) $unsaved.answer(false);
  },
});
</script>

<template>
  <UModal v-model:open="open" title="Leave without saving?">
    <template #body>
      <p class="text-sm" data-testid="leave-dialog">
        Something on this page has been typed and not saved. Leaving now throws it away, and
        there is nothing to undo it with.
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" data-testid="leave-stay" @click="$unsaved.answer(false)">
          Keep editing
        </UButton>
        <UButton color="error" data-testid="leave-discard" @click="$unsaved.answer(true)">
          Discard and leave
        </UButton>
      </div>
    </template>
  </UModal>
</template>
