<!--
  A search box that does not rewrite the address bar per keystroke.

  What is typed is local until it is meant: Enter, or leaving the box. The
  filter lives in the URL, and a router replace per character would make the
  address bar flicker, the query refire on every letter and the back button
  walk the word backwards. The value is pushed back in whenever the URL says
  something else, so the box still follows a link, a reload or a Clear.
-->
<script setup lang="ts">
const props = defineProps<{
  /** What the URL says, which is what the box shows until it is typed in. */
  text: string;
  testid: string;
  placeholder?: string;
}>();

const emit = defineEmits<{ commit: [string] }>();

const typed = ref(props.text);
watch(
  () => props.text,
  (next) => {
    if (next !== typed.value) typed.value = next;
  },
);
</script>

<template>
  <UInput
    v-model="typed"
    icon="i-lucide-search"
    :placeholder="props.placeholder ?? 'Search title, body and comments'"
    :ui="{ trailing: 'pe-1' }"
    :data-testid="props.testid"
    @keydown.enter="emit('commit', typed)"
    @blur="emit('commit', typed)"
  >
    <template v-if="typed !== ''" #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        icon="i-lucide-x"
        aria-label="Clear the search"
        @click="((typed = ''), emit('commit', ''))"
      />
    </template>
  </UInput>
</template>
