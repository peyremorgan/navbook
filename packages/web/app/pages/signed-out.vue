<!--
  Where signing out lands.

  It exists because everything else needs a token: sending somebody to a
  guarded page after removing theirs would bounce them straight back to the
  provider. This page asks first. It is also the `post_logout_redirect_uri`, so
  a provider that ended its own session sends the browser back here — and one
  that could not would sign them in again without asking, whatever this page
  offers.
-->
<script setup lang="ts">
import { pageTitle } from "~/utils/title";

definePageMeta({ layout: false });

useHead({ title: pageTitle("Signed out") });

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
