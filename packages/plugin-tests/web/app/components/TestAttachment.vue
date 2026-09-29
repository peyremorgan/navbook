<!--
  One file beside a run: a picture drawn inline, anything else a download.

  The bytes come through the API (`testAttachment`), authenticated like every
  other read, and are turned into a `data:` address here. A picture is fetched
  as soon as it is shown; anything else only when somebody asks for it.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { TEST_ATTACHMENT_QUERY } from "../graphql/queries";
import { isImage } from "../utils/tests";

const props = defineProps<{ run: string; name: string }>();

const picture = computed(() => isImage(props.name));
const wanted = ref(picture.value);
const { result, loading, error } = useQuery(
  TEST_ATTACHMENT_QUERY,
  () => ({ run: props.run, name: props.name }),
  () => ({ enabled: wanted.value, fetchPolicy: "cache-first" }),
);
const file = computed(() => result.value?.testAttachment ?? null);
const address = computed(() =>
  file.value ? `data:${file.value.contentType};base64,${file.value.base64}` : null,
);

/** Hand the file to the browser. */
function hand(value: string): void {
  const link = document.createElement("a");
  link.href = value;
  link.download = props.name;
  link.click();
}

/** Fetch it the first time; after that it is already here. */
function download(): void {
  if (address.value !== null) hand(address.value);
  else wanted.value = true;
}

watch(address, (value) => {
  if (value !== null && !picture.value) hand(value);
});
</script>

<template>
  <figure class="space-y-1" :data-testid="`test-attachment-${props.name}`">
    <img
      v-if="picture && address"
      :src="address"
      :alt="props.name"
      class="max-h-80 rounded border border-default"
      :data-testid="`test-attachment-image-${props.name}`"
    />
    <p v-else-if="picture && loading" class="text-xs text-muted">Loading {{ props.name }}…</p>
    <figcaption class="flex items-center gap-2 text-xs text-muted">
      <UIcon :name="picture ? 'i-lucide-image' : 'i-lucide-paperclip'" class="size-3" />
      <code>{{ props.name }}</code>
      <UButton
        v-if="!picture"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-download"
        :loading="loading"
        :data-testid="`test-attachment-download-${props.name}`"
        @click="download"
      >
        Download
      </UButton>
      <span v-if="error" class="text-error">could not be read</span>
    </figcaption>
  </figure>
</template>
