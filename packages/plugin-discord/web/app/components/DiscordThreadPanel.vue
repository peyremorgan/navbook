<!--
  Where a record is discussed in Discord, on its page.

  Registered as a panel on issues and pull requests. The host hands a panel the
  page's edit state, which carries no ID, so this reads the route and asks the
  bridge, as plugin-tests' panel does; it draws nothing when there is no thread
  or no bridge.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { DISCORD_THREAD_QUERY } from "../graphql/queries";

defineProps<{
  /** Declared and not read, so none is passed through onto the root element. */
  entity?: unknown;
  saving?: boolean;
  fieldSave?: unknown;
  disabled?: boolean;
}>();

const route = useRoute();
const ref_ = computed(() => String(route.params.ref ?? ""));
const { result } = useQuery(DISCORD_THREAD_QUERY, () => ({ ref: ref_.value }), {
  fetchPolicy: "cache-and-network",
  errorPolicy: "all",
});
const thread = computed(() => result.value?.discord?.thread ?? null);
</script>

<template>
  <section v-if="thread" class="space-y-2 border-t border-default pt-4" data-testid="discord-panel">
    <h3 class="text-sm font-medium">Discord</h3>
    <UButton
      :to="thread.url"
      target="_blank"
      rel="noopener"
      size="sm"
      color="neutral"
      variant="subtle"
      icon="i-lucide-messages-square"
      data-testid="open-in-discord"
    >
      Open the thread
    </UButton>
  </section>
</template>
