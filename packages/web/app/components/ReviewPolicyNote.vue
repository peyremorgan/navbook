<!--
  How this repository counts reviews (spec 02 §2.10).

  A property of the repository rather than of this pull request, so it sits
  under the reviewers instead of beside the decision: it explains the badge
  rather than restating it, which is what a reader looking at "pending" beside
  an approval actually needs.

  Nothing is drawn where nothing is declared. A repository that never opted in
  reads exactly as it did, and a line saying "one approval, self-review off" on
  every pull request in it would be noise about a choice nobody made.

  A marker nobody can read is shown as a warning rather than hidden, because
  the numbers above it are then the defaults and saying so is the only way a
  reader can tell a policy from a typo. `nav doctor` reports the same fault as
  D15, with the file to fix.
-->
<script setup lang="ts">
import { describePolicy, type ReviewPolicy } from "~/utils/reviews";

const props = defineProps<{ policy?: ReviewPolicy | null }>();

const summary = computed(() => describePolicy(props.policy));
const problems = computed(() => props.policy?.problems ?? []);
</script>

<template>
  <div v-if="summary || problems.length" class="space-y-1.5">
    <p v-if="summary" class="text-xs text-muted" data-testid="review-policy">
      {{ summary }}
    </p>
    <UAlert
      v-if="problems.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="The review policy could not be read"
      data-testid="review-policy-problems"
    >
      <template #description>
        <ul class="list-disc space-y-0.5 ps-4">
          <li v-for="problem in problems" :key="problem">
            <code>navbook.json</code> {{ problem }}
          </li>
        </ul>
        <p class="mt-1.5">Counting by the defaults until it is fixed.</p>
      </template>
    </UAlert>
  </div>
</template>
