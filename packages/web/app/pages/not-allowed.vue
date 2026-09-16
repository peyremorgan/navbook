<!--
  Where a signed-in person the server refused is sent.

  The token verified — the provider vouches for them — and the repository's
  authorization policy does not admit them (`FORBIDDEN`). That is not the
  situation the provider can fix, so this page does not send them there:
  signing in again would come straight back here. It says what happened, names
  the account so that a person with two knows which one this is, and offers
  two things. Trying again, for the person whose access was granted while they
  sat here, since the token is still good and nothing on this page re-asks the
  server; and signing out, for signing in as somebody else — as far as the
  provider allows, since ending its session is its business, not this app's.

  The route is exempt from the guard, so it also renders for somebody with no
  session at all — back from `/signed-out`, or from a bookmark. They are
  offered signing in, since signing out would remove nothing.
-->
<script setup lang="ts">
import { HOME } from "~/utils/navigation";

definePageMeta({ layout: false });
const auth = useAuth();
</script>

<template>
  <AuthNotice icon="i-lucide-shield-off" title="This account is not allowed here" testid="not-allowed">
    <template v-if="auth.signedIn.value">
      You are signed in<template v-if="auth.email.value">
        as
        <span class="font-medium text-default" data-testid="not-allowed-email">{{
          auth.email.value
        }}</span></template
      >, but this repository's server does not admit that account. Ask whoever
      runs it for access, or sign out and sign in as somebody else.
    </template>
    <template v-else>
      This repository's server did not admit the account you signed in with.
      Ask whoever runs it for access, or sign in as somebody else.
    </template>
    <template #actions>
      <UButton data-testid="try-again" :to="HOME" color="neutral" variant="subtle">
        Try again
      </UButton>
      <UButton
        v-if="auth.signedIn.value"
        data-testid="sign-out"
        icon="i-lucide-log-out"
        @click="auth.logout()"
      >
        Sign out
      </UButton>
      <UButton v-else data-testid="sign-in" icon="i-lucide-log-in" @click="auth.login(HOME)">
        Sign in
      </UButton>
    </template>
  </AuthNotice>
</template>
