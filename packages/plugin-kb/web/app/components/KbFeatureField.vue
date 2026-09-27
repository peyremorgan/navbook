<!--
  Features on the new-issue form.

  Registered as a form field, so the host draws it above its own fields and
  merges what it holds into `openIssue`'s input — the field this plugin's SDL
  added to `OpenIssueInput`. One mutation, one commit, one file: filing an
  issue against a feature is not a second write.

  It reads the route because a feature's page links here with `?feature=<slug>`
  ("File an issue"), and arriving on a form that had forgotten which feature
  you came from would make that button pointless.
-->
<script setup lang="ts">
const props = defineProps<{
  /** The input being built, shared with the host's own fields. */
  extra: Record<string, unknown>;
  /** The page's query string, for a value a link pre-filled. */
  query: Record<string, unknown>;
}>();

const emit = defineEmits<{ "update:extra": [Record<string, unknown>] }>();

const { slugs } = useKbFeatures();

/** A `?feature=` parameter, however the router spelled it. */
function fromQuery(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

const features = ref<string[]>(fromQuery(props.query.feature));

// Pushed up on every change rather than read back down: the host owns the
// input, and this field owns what goes in under its own name.
watch(features, (next) => emit("update:extra", { ...props.extra, features: [...next] }), {
  immediate: true,
});
</script>

<template>
  <UFormField label="Features" description="The concepts this work belongs to.">
    <CreatableSelect
      v-model="features"
      :suggestions="slugs"
      placeholder="Attach to a feature"
      icon="i-lucide-layers"
      testid="new-features"
    />
  </UFormField>
</template>
