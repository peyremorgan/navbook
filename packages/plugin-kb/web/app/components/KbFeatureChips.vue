<!--
  The features an entity belongs to, as chips on its listing row.

  Registered as a row badge, so the host draws it outside the row's own link:
  these chips are links to a feature's page, and a link inside a link is not
  something a browser will draw (`IssueRow`).

  `where` says which listing this is. It is only used to name the chips for the
  end-to-end suite, but that naming matters — the same feature appears on an
  issue row and on an inbox row, and a test that could not tell them apart
  would pass while drawing one of them in the wrong place.
-->
<script setup lang="ts">
const props = defineProps<{
  entity: { ext?: Record<string, unknown> | null };
  /** `issue` on a listing row, `inbox-row` in the inbox. */
  where: string;
}>();

const features = computed(() => readKbFeatures(props.entity.ext));
</script>

<template>
  <div v-if="features.length" class="mt-1.5 flex flex-wrap gap-1">
    <NuxtLink
      v-for="feature in features"
      :key="feature"
      :to="`/features/${feature}`"
      :data-testid="`${props.where}-feature-${feature}`"
    >
      <UBadge color="neutral" variant="subtle" size="sm" class="hover:bg-elevated">
        <UIcon name="i-lucide-layers" class="me-1 size-3" />{{ feature }}
      </UBadge>
    </NuxtLink>
  </div>
</template>
