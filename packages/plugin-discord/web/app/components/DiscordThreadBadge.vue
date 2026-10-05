<!--
  A link to a record's Discord thread, on its listing row.

  Registered as a row badge, which the host draws on every kind of row, outside
  the row's own link. It reads `ext`, the one field a row the host fetched can
  carry for a plugin (spec 06 §6.3), and draws nothing for a record without a
  thread.
-->
<script setup lang="ts">
import { readDiscordThread } from "../utils/discord";

const props = defineProps<{
  entity: { ext?: Record<string, unknown> | null };
  where: string;
}>();

const thread = computed(() => readDiscordThread(props.entity.ext));
</script>

<template>
  <div v-if="thread" class="mt-1.5 flex">
    <UButton
      :to="thread"
      target="_blank"
      rel="noopener"
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-messages-square"
      aria-label="Open its thread in Discord"
      :data-testid="`${props.where}-discord`"
    >
      Discord
    </UButton>
  </div>
</template>
