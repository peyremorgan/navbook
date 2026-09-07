<!--
  What a pull request's reviews add up to (spec 02 §2.7).

  Never a gate. Navbook records reviews and leaves merge policy to the forge or
  to team convention (spec 01 §1.7), so this reports a reading of the files and
  nothing here disables anything.

  `PENDING` is drawn only where the pull request asked somebody, since "nobody
  has reviewed this" is worth saying about a review request and is only noise
  about a pull request that never made one.
-->
<script setup lang="ts">
import type { ReviewDecision } from "~~/src/generated/gql/graphql";

const props = defineProps<{ decision: ReviewDecision; asked?: boolean }>();

const LOOKS = {
  APPROVED: { label: "Approved", color: "success" as const, icon: "i-lucide-check-check" },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    color: "warning" as const,
    icon: "i-lucide-file-pen",
  },
  PENDING: { label: "Review pending", color: "neutral" as const, icon: "i-lucide-clock" },
};

const shown = computed(() =>
  props.decision === "PENDING" && props.asked !== true ? null : LOOKS[props.decision],
);
</script>

<template>
  <UBadge
    v-if="shown"
    :color="shown.color"
    :variant="props.decision === 'PENDING' ? 'outline' : 'subtle'"
    size="sm"
    :icon="shown.icon"
    data-testid="review-decision"
  >
    {{ shown.label }}
  </UBadge>
</template>
