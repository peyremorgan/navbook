<!--
  A pull request's tested state, on its listing row.

  Registered as a row badge, which the host draws on every kind of row; this
  one only means something beside a pull request, and only once it has been
  run, so it draws nothing anywhere else. It reads `ext`, the one field a row
  the host fetched can carry for a plugin (spec 06 §6.3).
-->
<script setup lang="ts">
import { readTestsExt } from "../utils/tests";

const props = defineProps<{
  entity: { ext?: Record<string, unknown> | null };
  /** `pr` on a pull request listing row; issues and the inbox have no tests. */
  where: string;
}>();

const tests = computed(() => (props.where === "pr" ? readTestsExt(props.entity.ext) : null));
</script>

<template>
  <div v-if="tests && tests.runs > 0" class="mt-1.5 flex flex-wrap gap-1" :data-testid="`${props.where}-tested-${tests.tested}`">
    <TestStateBadge :state="tests.tested === 'none' ? 'none' : tests.tested" />
  </div>
</template>
