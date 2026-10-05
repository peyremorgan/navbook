<!--
  An issue's polls, in its sidebar: each with where it stands and where the
  person looking stands on it, a link down to it in the discussion, and the
  way to open a new one.

  Registered as a panel. The host hands a panel the page's edit state, which
  carries no ID, so this reads the route and asks for what it needs;
  `issue(ref)` is the host's own field, so it shares the page's cache.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import type { EntityEdit } from "~/utils/patch";
import { ISSUE_POLLS_QUERY } from "../graphql/queries";

defineProps<{
  entity: EntityEdit;
  /** Declared and not read, so it is not passed through onto the root element. */
  saving: boolean;
  fieldSave?: unknown;
  disabled?: boolean;
}>();

const route = useRoute();
const ref_ = computed(() => String(route.params.ref ?? ""));
const { result } = useQuery(ISSUE_POLLS_QUERY, () => ({ ref: ref_.value }), {
  fetchPolicy: "cache-and-network",
});
const issue = computed(() => result.value?.issue ?? null);
const opening = ref(false);

const STANDING: Record<string, string> = {
  NONE: "Not voted",
  COUNTED: "Voted",
  WITHDRAWN: "Withdrew",
  REVOKED: "Vote again",
};

function goTo(id: string): void {
  document.getElementById(`timeline-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <section v-if="issue" class="space-y-2 border-t border-default pt-4" data-testid="poll-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">Polls</h3>
      <UButton
        v-if="issue.status === 'OPEN'"
        size="xs"
        color="neutral"
        variant="subtle"
        icon="i-lucide-plus"
        data-testid="poll-new"
        @click="opening = true"
      >
        New poll
      </UButton>
    </div>
    <p v-if="issue.polls.length === 0" class="text-sm text-muted">None yet.</p>
    <ul v-else class="space-y-1">
      <li v-for="poll in issue.polls" :key="poll.id">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start text-sm hover:bg-elevated/50"
          :data-testid="`poll-panel-${poll.id}`"
          @click="goTo(poll.id)"
        >
          <UIcon
            :name="poll.status === 'OPEN' ? 'i-lucide-vote' : 'i-lucide-lock'"
            class="size-3.5 shrink-0"
            :class="poll.status === 'OPEN' ? 'text-success' : 'text-muted'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">{{ poll.title }}</span>
          <span v-if="poll.status === 'OPEN'" class="shrink-0 text-xs text-muted">
            {{ STANDING[poll.myState] }}
          </span>
          <span v-else class="shrink-0 text-xs text-muted">Closed</span>
        </button>
      </li>
    </ul>
    <PollEditor v-model:open="opening" :issue="issue.id" @saved="(id: string) => nextTick(() => goTo(id))" />
  </section>
</template>
