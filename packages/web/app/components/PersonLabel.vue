<script setup lang="ts">
import { displayPerson } from "~/utils/people";

const props = defineProps<{ person: string; avatar?: boolean }>();
const shown = computed(() => displayPerson(props.person));
</script>

<template>
  <span class="inline-flex items-center gap-1.5" :title="props.person">
    <UAvatar v-if="props.avatar" :alt="shown.label" size="3xs" />
    <span>{{ shown.label }}</span>
  </span>
</template>
