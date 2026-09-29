<!--
  The way in: a round button in the lower right corner of every page, and the
  slideover it opens.

  Shown only when the server offers an assistant. `chat` answers null when no
  model is configured, and a server without this plugin refuses the field
  altogether; either way there is nothing to open, and the query's failure is
  kept quiet — Apollo's error link toasts only for mutations.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { CHAT_STATUS_QUERY } from "../graphql/queries";

const { result } = useQuery(CHAT_STATUS_QUERY, null, {
  fetchPolicy: "cache-first",
  errorPolicy: "all",
});
const status = computed(() => result.value?.chat ?? null);
const session = useChatSession();
</script>

<template>
  <template v-if="status">
    <UButton
      v-if="!session.open.value"
      icon="i-lucide-message-circle"
      size="xl"
      class="fixed right-6 bottom-6 z-50 rounded-full shadow-lg"
      aria-label="Ask the assistant"
      data-testid="chat-launcher"
      @click="session.open.value = true"
    />
    <USlideover
      v-model:open="session.open.value"
      side="right"
      title="Assistant"
      :description="`${status.model} · ${status.endpoint}`"
      :ui="{ content: 'w-full sm:max-w-[460px]', body: 'flex min-h-0 flex-col p-0 sm:p-0' }"
    >
      <template #body>
        <ChatPanel />
      </template>
    </USlideover>
  </template>
</template>
