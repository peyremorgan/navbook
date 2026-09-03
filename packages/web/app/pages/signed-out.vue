<!--
  Where signing out lands.

  It exists because everything else needs a token: sending somebody to a
  guarded page after removing theirs would bounce them straight back to the
  provider, and a provider still holding a session cookie would sign them in
  again without asking. This page asks.
-->
<script setup lang="ts">
definePageMeta({ layout: false });
const auth = useAuth();
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-default p-6">
    <div class="space-y-4 text-center" data-testid="signed-out">
      <UIcon name="i-lucide-notebook-text" class="size-8 text-primary" />
      <h1 class="text-lg font-semibold">You are signed out</h1>
      <p class="text-sm text-muted">
        Navbook needs an identity to act under: every issue and comment records
        who wrote it.
      </p>
      <UButton data-testid="sign-in-again" @click="auth.login('/issues')">Sign in again</UButton>
    </div>
  </div>
</template>
