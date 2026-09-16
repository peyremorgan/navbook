<!--
  A full-screen notice for the pages that render without the app around them.

  Signing out, being refused: each is a moment with nothing else to show —
  no navigation, no listing, no account menu, since every one of those needs
  a token the person no longer has or may not use. One shape for all of them,
  so they read as the same kind of page and change together.
-->
<script setup lang="ts">
defineProps<{
  icon: string;
  title: string;
  testid: string;
}>();
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-default p-6">
    <div class="max-w-md space-y-4 text-center" :data-testid="testid">
      <UIcon :name="icon" class="size-8 text-primary" />
      <h1 class="text-lg font-semibold">{{ title }}</h1>
      <p class="text-sm text-muted">
        <slot />
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
