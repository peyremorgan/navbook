<!--
  Filing an issue.

  A title and a description, both required — the format needs a title to name
  the directory, and an issue with no body is one nobody can act on. Everything
  else is optional and can be set here to save a second edit.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY, ISSUES_QUERY } from "~/graphql/queries";
import { distinctValues } from "~/utils/entities";
import { normalizeList, normalizeOptional, parseRankInput } from "~/utils/patch";

const route = useRoute();
const toast = useToast();
const mutations = useIssueMutations();

const title = ref("");
const body = ref("");
const labels = ref<string[]>([]);
const assignees = ref<string[]>([]);
const milestone = ref("");
const rank = ref("");
const deadline = ref("");
/** Pre-filled when the page was reached from a feature's "file an issue". */
const features = ref<string[]>(featureFromQuery(route.query.feature));
/** Pre-filled when the page was reached from an issue's "add subtask". */
const parent = ref(String(route.query.parent ?? ""));

/** A `?feature=` parameter, however the router spelled it. */
function featureFromQuery(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/* For labels, the only source of suggestions there is; see the detail page. */
const { result: listing } = useQuery(ISSUES_QUERY, { filter: {} }, { fetchPolicy: "cache-first" });
const { result: featureList } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-first",
});
/* Asked of the server, which knows who is around; the listing does not. */
const people = usePeople();
const known = computed(() => {
  const issues = listing.value?.issues ?? [];
  return {
    labels: distinctValues(issues, (item) => item.labels),
    milestones: distinctValues(issues, (item) => (item.milestone ? [item.milestone] : [])),
    // A real registry, unlike the labels above.
    features: (featureList.value?.features ?? []).map((feature) => feature.slug),
  };
});

const ready = computed(() => title.value.trim() !== "" && body.value.trim() !== "");

async function submit(): Promise<void> {
  if (!ready.value) return;
  // The one field a browser will hand over as text it cannot make a number of.
  const placed = parseRankInput(rank.value);
  if (placed !== null && !Number.isFinite(placed)) {
    toast.add({ title: "That will not do", description: "A rank is a number.", color: "error" });
    return;
  }
  const payload = await mutations.openIssue({
    title: title.value.trim(),
    body: body.value.trim(),
    labels: normalizeList(labels.value),
    assignees: normalizeList(assignees.value),
    milestone: normalizeOptional(milestone.value),
    features: normalizeList(features.value),
    rank: placed,
    deadline: normalizeOptional(deadline.value),
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
          :suggestions="people"
          testid="new-assignees"
        />
      </UFormField>
      <UFormField label="Milestone">
        <UInput v-model="milestone" class="w-full" data-testid="new-milestone" />
      </UFormField>
      <UFormField label="Rank" description="Where it sits in the queue; lower comes first.">
        <UInput
          v-model="rank"
          type="number"
          step="any"
          class="w-full"
          data-testid="new-rank"
        />
      </UFormField>
      <UFormField label="Deadline" description="The day the work is wanted.">
        <UInput v-model="deadline" type="date" class="w-full" data-testid="new-deadline" />
      </UFormField>
      <UFormField label="Features" description="The concepts this work belongs to.">
        <CreatableSelect
          v-model="features"
          :suggestions="known.features"
          placeholder="Attach to a feature"
          icon="i-lucide-layers"
          testid="new-features"
        />
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
