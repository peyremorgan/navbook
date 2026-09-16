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
  <AuthNotice icon="i-lucide-notebook-text" title="You are signed out" testid="signed-out">
    Navbook needs an identity to act under: every issue and comment records who
    wrote it.
    <template #actions>
      <UButton data-testid="sign-in-again" @click="auth.login('/issues')">Sign in again</UButton>
    </template>
  </AuthNotice>
</template>
