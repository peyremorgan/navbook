<!--
  Filing an issue.

  A title and a description, both required — the format needs a title to name
  the directory, and an issue with no body is one nobody can act on. Everything
  else is optional and can be set here to save a second edit.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { ISSUES_QUERY } from "~/graphql/queries";
import { distinctValues } from "~/utils/entities";
import { normalizeList, normalizeOptional } from "~/utils/patch";

const route = useRoute();
const mutations = useIssueMutations();

const title = ref("");
const body = ref("");
const labels = ref<string[]>([]);
const assignees = ref<string[]>([]);
const milestone = ref("");
/** Pre-filled when the page was reached from an issue's "add subtask". */
const parent = ref(String(route.query.parent ?? ""));

/* The only source of suggestions there is; see the detail page for why. */
const { result: listing } = useQuery(ISSUES_QUERY, { filter: {} }, { fetchPolicy: "cache-first" });
const known = computed(() => {
  const issues = listing.value?.issues ?? [];
  return {
    labels: distinctValues(issues, (item) => item.labels),
    assignees: distinctValues(issues, (item) => item.assignees),
    milestones: distinctValues(issues, (item) => (item.milestone ? [item.milestone] : [])),
  };
});

const ready = computed(() => title.value.trim() !== "" && body.value.trim() !== "");

async function submit(): Promise<void> {
  if (!ready.value) return;
  const payload = await mutations.openIssue({
    title: title.value.trim(),
    body: body.value.trim(),
    labels: normalizeList(labels.value),
    assignees: normalizeList(assignees.value),
    milestone: normalizeOptional(milestone.value),
    parent: normalizeOptional(parent.value),
  });
  if (payload) await navigateTo(`/issues/${payload.issue.id}`);
}
</script>

<template>
  <form class="mx-auto max-w-3xl space-y-5" data-testid="new-issue-form" @submit.prevent="submit">
    <h1 class="text-xl font-semibold">File an issue</h1>

    <UFormField label="Title" required>
      <UInput
        v-model="title"
        placeholder="What is wrong, in one line"
        class="w-full"
        data-testid="new-title"
      />
    </UFormField>

    <UFormField label="Description" required description="Markdown is rendered.">
      <UTextarea
        v-model="body"
        :rows="10"
        autoresize
        class="w-full"
        placeholder="What happens, what you expected, and how to see it."
        data-testid="new-body"
      />
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Labels">
        <CreatableSelect v-model="labels" :suggestions="known.labels" testid="new-labels" />
      </UFormField>
      <UFormField label="Assignees">
        <CreatableSelect
          v-model="assignees"
          :suggestions="known.assignees"
          testid="new-assignees"
        />
      </UFormField>
      <UFormField label="Milestone">
        <UInput v-model="milestone" class="w-full" data-testid="new-milestone" />
      </UFormField>
      <UFormField label="Parent" description="File it under another issue, by id or prefix.">
        <UInput v-model="parent" class="w-full" data-testid="new-parent" />
      </UFormField>
    </div>

    <div class="flex gap-2">
      <UButton
        type="submit"
        :disabled="!ready"
        :loading="mutations.busy.value"
        data-testid="submit-issue"
      >
        File it
      </UButton>
      <UButton to="/issues" color="neutral" variant="ghost">Cancel</UButton>
    </div>
  </form>
</template>
