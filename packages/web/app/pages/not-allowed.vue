<!--
  Where a signed-in person the server refused is sent.

  The token verified — the provider vouches for them — and the repository's
  authorization policy does not admit them (`FORBIDDEN`). That is not the
  situation the provider can fix, so this page does not send them there:
  signing in again would come straight back here. It says what happened, names
  the account so that a person with two knows which one this is, and offers
  the one thing that changes anything, which is signing out to sign in as
  somebody else.
-->
<script setup lang="ts">
definePageMeta({ layout: false });
const auth = useAuth();
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-default p-6">
    <div class="max-w-md space-y-4 text-center" data-testid="not-allowed">
      <UIcon name="i-lucide-shield-off" class="size-8 text-primary" />
      <h1 class="text-lg font-semibold">This account is not allowed here</h1>
      <p class="text-sm text-muted">
        <template v-if="auth.email.value">
          You are signed in as
          <span class="font-medium text-default" data-testid="not-allowed-email">{{
            auth.email.value
          }}</span
          >, but this repository's server does not admit that account.
        </template>
        <template v-else>
          You are signed in, but this repository's server does not admit that account.
        </template>
        Ask whoever runs it for access, or sign out and sign in as somebody else.
      </p>
      <UButton data-testid="sign-out" icon="i-lucide-log-out" @click="auth.logout()">
        Sign out
      </UButton>
    </div>
  </div>
</template>
