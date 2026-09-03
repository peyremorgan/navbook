<script setup lang="ts">
import { statusColor, statusLabel } from "~/utils/entities";
import type { Status } from "~~/src/generated/gql/graphql";

const props = defineProps<{ status: Status; draft?: boolean }>();
</script>

<template>
  <UBadge v-if="props.draft && props.status === 'OPEN'" color="neutral" variant="subtle" size="sm">
    Draft
  </UBadge>
  <UBadge v-else :color="statusColor(props.status)" variant="subtle" size="sm">
    {{ statusLabel(props.status) }}
  </UBadge>
</template>
