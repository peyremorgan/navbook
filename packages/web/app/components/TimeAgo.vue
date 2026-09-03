<script setup lang="ts">
import { absoluteTime, relativeTime } from "~/utils/entities";

const props = defineProps<{ iso: string }>();
</script>

<template>
  <time :datetime="props.iso" :title="absoluteTime(props.iso)">{{ relativeTime(props.iso) }}</time>
</template>
