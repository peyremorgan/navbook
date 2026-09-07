<!--
  Who was asked to review, and what each of them has said about the latest
  revision.

  None of this is in a file: `reviewer:` records who was asked, and the states
  below are read back from the reviews against the latest revision (spec 02
  §2.7). That is why a new revision empties the column without anybody editing
  anything — the reviews it shows now judge a state of the branch that has been
  superseded.

  Somebody who reviewed without being asked is marked as such rather than
  hidden: their verdict counts, and pretending otherwise would misreport the
  decision beside it.
-->
<script setup lang="ts">
import type { PrDetailFragment } from "~~/src/generated/gql/graphql";

const props = defineProps<{ reviews: PrDetailFragment["reviews"] }>();

const LOOKS = {
  APPROVE: { label: "Approved", color: "success" as const, icon: "i-lucide-check-check" },
  REQUEST_CHANGES: {
    label: "Changes requested",
    color: "warning" as const,
    icon: "i-lucide-file-pen",
  },
  COMMENTED: { label: "Commented", color: "neutral" as const, icon: "i-lucide-message-square" },
  PENDING: { label: "Pending", color: "neutral" as const, icon: "i-lucide-clock" },
};

const rows = computed(() =>
  props.reviews.map((review) => ({ ...review, look: LOOKS[review.state] })),
);
</script>

<template>
  <ul v-if="rows.length" class="space-y-1.5 text-sm" data-testid="reviewer-states">
    <li
      v-for="review in rows"
      :key="review.person"
      class="flex flex-wrap items-center gap-x-2 gap-y-1"
      :data-testid="`reviewer-${review.person}`"
    >
      <PersonLabel :person="review.person" avatar />
      <UBadge
        :color="review.look.color"
        :variant="review.state === 'PENDING' ? 'outline' : 'subtle'"
        size="sm"
        :icon="review.look.icon"
      >
        {{ review.look.label }}
      </UBadge>
      <span v-if="review.volunteer" class="text-xs text-muted">not asked</span>
    </li>
  </ul>
  <p v-else class="text-sm text-muted">Nobody asked yet.</p>
</template>
