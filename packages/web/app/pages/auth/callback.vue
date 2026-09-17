<!--
  Where the provider sends the browser back to.

  The code in the address bar is single use and this page is what spends it, so
  it does one thing and leaves: on success, to wherever the person was going
  when they were interrupted. A failure stays put and says what happened, since
  bouncing straight back to the provider would loop.
-->
<script setup lang="ts">
import { pageTitle } from "~/utils/title";

definePageMeta({ layout: false });

useHead({ title: pageTitle("Signing in") });

const auth = useAuth();
const failure = ref<string | null>(null);

onMounted(async () => {
  try {
    await navigateTo(await auth.completeLogin(), { replace: true });
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <div class="grid min-h-screen place-items-center p-6">
    <UAlert
      v-if="failure"
      color="error"
      icon="i-lucide-triangle-alert"
      title="Signing in did not finish"
      :description="failure"
      :actions="[{ label: 'Try again', to: '/', color: 'neutral', variant: 'subtle' }]"
      class="max-w-lg"
    />
    <p v-else class="text-muted">Signing you in…</p>
  </div>
</template>
