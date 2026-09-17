<!--
  Every feature.

  Unlike labels and milestones, features are a real registry — directories that
  exist whether or not any issue names them yet — so this listing is the whole
  answer rather than whatever the issues on screen happen to mention.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY } from "~/graphql/queries";
import { pageTitle } from "~/utils/title";

useHead({ title: pageTitle("Features") });

const mutations = useFeatureMutations();

const { result, loading, error, refetch } = useQuery(FEATURES_QUERY, undefined, {
  fetchPolicy: "cache-and-network",
});
const features = computed(() => result.value?.features ?? []);

const creating = ref(false);
const title = ref("");
const slug = ref("");
const summary = ref("");

/** What the server would derive, shown so the directory name is no surprise. */
const derived = computed(() =>
  title.value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, ""),
);

function open(): void {
  title.value = "";
  slug.value = "";
  summary.value = "";
  creating.value = true;
}

async function submit(): Promise<void> {
  if (title.value.trim() === "") return;
  const payload = await mutations.createFeature({
    title: title.value.trim(),
    slug: slug.value.trim() === "" ? null : slug.value.trim(),
    summary: summary.value.trim() === "" ? null : summary.value.trim(),
  });
  if (!payload) return;
  creating.value = false;
  await navigateTo(`/features/${payload.feature.slug}`);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-xl font-semibold">Features</h1>
      <UButton icon="i-lucide-plus" data-testid="new-feature" @click="open">New feature</UButton>
    </div>

    <QueryState
      :loading="loading && features.length === 0"
      :error="error"
      :empty="features.length === 0"
      empty-title="No features yet"
      empty-description="A feature is a standing concept that issues attach to: a business vertical, or a goal too large to be one issue."
      @retry="refetch()"
    >
      <div class="rounded-lg border border-default" data-testid="feature-list">
        <FeatureRow v-for="feature in features" :key="feature.slug" :feature="feature" />
      </div>
    </QueryState>

    <UModal v-model:open="creating" title="New feature">
      <template #body>
        <form class="space-y-4" data-testid="new-feature-form" @submit.prevent="submit">
          <UFormField label="Title" required>
            <UInput
              v-model="title"
              placeholder="What the feature is called"
              class="w-full"
              data-testid="new-feature-title"
            />
          </UFormField>
          <UFormField
            label="Directory"
            :description="
              slug.trim() === ''
                ? `Derived from the title: specs/${derived || '…'}/`
                : 'Named explicitly.'
            "
          >
            <UInput
              v-model="slug"
              :placeholder="derived"
              class="w-full"
              data-testid="new-feature-slug"
            />
          </UFormField>
          <UFormField label="Summary" description="Optional. The documents carry the detail.">
            <UTextarea v-model="summary" :rows="4" class="w-full" data-testid="new-feature-summary" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex gap-2">
          <UButton
            :disabled="title.trim() === ''"
            :loading="mutations.busy.value"
            data-testid="new-feature-submit"
            @click="submit"
          >
            Create feature
          </UButton>
          <UButton color="neutral" variant="ghost" @click="creating = false">Cancel</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
