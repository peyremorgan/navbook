<!--
  An outcome, a tested state or a step's status, as a badge.

  Takes what the API sends (`IN_PROGRESS`, `PASSED`, null for a step not run)
  or what `ext` carries (`in-progress`), so every place a state is drawn draws
  it the same way.
-->
<script setup lang="ts">
import { stateLook, stateOf } from "../utils/tests";

const props = defineProps<{ state: string | null | undefined; size?: "sm" | "md" }>();

const state = computed(() => stateOf(props.state));
const look = computed(() => stateLook(state.value));
</script>

<template>
  <UBadge
    :color="look.color"
    variant="subtle"
    :size="props.size ?? 'sm'"
    :icon="look.icon"
    :data-state="state"
  >
    {{ look.label }}
  </UBadge>
</template>
