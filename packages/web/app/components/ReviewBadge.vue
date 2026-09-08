<!--
  What a pull request's reviews add up to (spec 02 §2.7), counted by the policy
  the repository declares (§2.10).

  Never a gate. Navbook records reviews and enforces nothing (spec 01 §1.7), so
  this reports a reading of the files and nothing here disables anything. The
  policy is why a badge may say `pending` where somebody has already approved,
  which is exactly why the count is drawn beside it: a decision nobody can
  account for reads as a bug in the page rather than a repository asking for a
  second look.

  `PENDING` is drawn only where the pull request asked somebody, since "nobody
  has reviewed this" is worth saying about a review request and is only noise
  about a pull request that never made one. A shortfall counts as having been
  asked: something is outstanding whether or not anybody was named.
-->
<script setup lang="ts">
import { type Approvals, approvalLabel } from "~/utils/reviews";
import type { ReviewDecision } from "~~/src/generated/gql/graphql";

const props = defineProps<{
  decision: ReviewDecision;
  asked?: boolean;
  approvals?: Approvals | null;
}>();

const LOOKS = {
  APPROVED: { label: "Approved", color: "success" as const, icon: "i-lucide-check-check" },
  CHANGES_REQUESTED: {
    label: "Changes requested",
    color: "warning" as const,
    icon: "i-lucide-file-pen",
  },
  PENDING: { label: "Review pending", color: "neutral" as const, icon: "i-lucide-clock" },
};

const count = computed(() => approvalLabel(props.approvals));

const shown = computed(() => {
  const outstanding = props.asked === true || count.value !== null;
  return props.decision === "PENDING" && !outstanding ? null : LOOKS[props.decision];
});

const label = computed(() =>
  count.value === null || !shown.value
    ? shown.value?.label
    : `${shown.value.label} · ${count.value}`,
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
    {{ label }}
  </UBadge>
</template>
