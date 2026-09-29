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
import { normalizeList, normalizeOptional, parseRankInput, withPluginFields } from "~/utils/patch";
import { pageTitle } from "~/utils/title";

useHead({ title: pageTitle("New issue") });

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
/** Pre-filled when the page was reached from an issue's "add subtask". */
const parent = ref(String(route.query.parent ?? ""));

// What plugin fields have been filled in, merged into the mutation's input.
// One object rather than a ref per field, because the host cannot know what a
// plugin will add and a plugin should not have to ask for state of its own.
const slots = useNavbookSlots();
const extra = ref<Record<string, unknown>>({});

// The first value each plugin field pushes up, which is its pre-fill — a
// `?feature=` it read from the link here — rather than anything typed. Kept
// per key as it arrives, since a field may mount after the page does.
const prefilledExtra = new Map<string, string>();
watch(
  extra,
  (next) => {
    for (const [key, value] of Object.entries(next)) {
      if (!prefilledExtra.has(key)) prefilledExtra.set(key, JSON.stringify(value));
    }
  },
  { immediate: true, flush: "sync" },
);

/**
 * Set once the issue exists, so the navigation to it is not asked about: what
 * was typed is in the repository now. The pre-filled parent and plugin fields
 * are where the page was opened from rather than anything typed, so only a
 * change to them counts.
 */
const filed = ref(false);
const prefilledParent = parent.value;
useUnsavedWork(
  () =>
    !filed.value &&
    ([title, body, milestone, rank, deadline].some((field) => String(field.value).trim() !== "") ||
      labels.value.length > 0 ||
      assignees.value.length > 0 ||
      parent.value !== prefilledParent ||
      Object.entries(extra.value).some(
        ([key, value]) => prefilledExtra.get(key) !== JSON.stringify(value),
      )),
);

/* For labels, the only source of suggestions there is; see the detail page. */
const { result: listing } = useQuery(ISSUES_QUERY, { filter: {} }, { fetchPolicy: "cache-first" });
/* Asked of the server, which knows who is around; the listing does not. */
const people = usePeople();
const known = computed(() => {
  const issues = listing.value?.issues ?? [];
  return {
    labels: distinctValues(issues, (item) => item.labels),
    milestones: distinctValues(issues, (item) => (item.milestone ? [item.milestone] : [])),
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
  // A plugin's fields go in alongside, as fields its own SDL added: the
  // generated input type describes the core schema and cannot know about
  // them. One that names a field of the format's own is dropped, so a plugin
  // cannot quietly replace a value the person set here.
  const payload = await mutations.openIssue(
    withPluginFields(
      {
        title: title.value.trim(),
        body: body.value.trim(),
        labels: normalizeList(labels.value),
        assignees: normalizeList(assignees.value),
        milestone: normalizeOptional(milestone.value),
        rank: placed,
        deadline: normalizeOptional(deadline.value),
        parent: normalizeOptional(parent.value),
      },
      extra.value,
    ),
  );
  if (payload) {
    filed.value = true;
    await navigateTo(`/issues/${payload.issue.id}`);
  }
}
</script>

<template>
  <form class="mx-auto max-w-3xl space-y-5" data-testid="new-issue-form" @submit.prevent="submit">
    <h1 class="text-xl font-semibold">File an issue</h1>

    <!-- Fields plugin layers registered, before the built-in ones they know nothing about. -->
    <component
      :is="field.component"
      v-for="(field, index) in slots.formFields('issue-new')"
      :key="`field-${index}`"
      v-model:extra="extra"
      :query="route.query"
    />

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
