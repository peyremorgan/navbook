<!--
  Linking a Discord account to the signed-in person — the page `/nav link`
  sends somebody to, with a one-time code.

  The code is not redeemed by opening the page: a link is followed by
  previews and by people who were sent it by mistake, and a code works once.
  The page says whose account it would link to whom and asks. Without a code
  it shows the link there is, and offers to undo it.
-->
<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { describeApiError, sayFailure } from "~/utils/errors";
import { pageTitle } from "~/utils/title";
import { LINK_DISCORD, UNLINK_DISCORD } from "../../graphql/mutations";
import { DISCORD_LINK_QUERY } from "../../graphql/queries";

useHead({ title: pageTitle("Discord") });

const route = useRoute();
const code = computed(() => {
  const value = route.query.code;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
});

const { result, loading, refetch } = useQuery(DISCORD_LINK_QUERY, undefined, {
  fetchPolicy: "network-only",
  errorPolicy: "all",
});
const offered = computed(() => result.value?.discord != null);
const email = computed(() => result.value?.viewer.email ?? "");
const link = computed(() => result.value?.viewer.discord ?? null);

// Every refusal is this page's to show, beside the button that met it.
const handled = { context: { handled: true } };
const linking = useMutation(LINK_DISCORD, () => handled);
const unlinking = useMutation(UNLINK_DISCORD, () => handled);
const commit = useCommitToast();
const failure = ref<{ heading: string; message: string } | null>(null);
const linked = ref<string | null>(null);

async function confirm(): Promise<void> {
  if (code.value === null) return;
  failure.value = null;
  try {
    const payload = (await linking.mutate({ code: code.value }))?.data?.linkDiscord;
    if (!payload) return;
    commit.report(payload.commit, "Linked");
    linked.value = payload.link?.username ?? payload.link?.userId ?? "your account";
    await refetch();
  } catch (error) {
    failure.value = sayFailure(describeApiError(error));
  }
}

async function unlink(): Promise<void> {
  failure.value = null;
  try {
    const payload = (await unlinking.mutate())?.data?.unlinkDiscord;
    if (payload) commit.report(payload.commit, "Unlinked");
    linked.value = null;
    await refetch();
  } catch (error) {
    failure.value = sayFailure(describeApiError(error));
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4">
    <h1 class="text-xl font-semibold">Discord</h1>

    <p v-if="loading && !result" class="text-sm text-muted">Loading…</p>

    <UAlert
      v-else-if="!offered"
      color="neutral"
      icon="i-lucide-info"
      title="No Discord bridge"
      description="This tracker's server runs no Discord bridge, so there is nothing to link an account to."
      data-testid="discord-not-offered"
    />

    <template v-else>
      <UAlert
        v-if="failure"
        color="error"
        icon="i-lucide-circle-alert"
        :title="failure.heading"
        :description="failure.message"
        data-testid="discord-link-error"
      />

      <div v-if="linked" class="space-y-2" data-testid="discord-linked">
        <p>
          Linked <strong>{{ linked }}</strong> to <strong>{{ email }}</strong>. What that account
          does from Discord is now recorded as you.
        </p>
      </div>

      <div v-else-if="code" class="space-y-3">
        <p>
          Link the Discord account that asked for this code to
          <strong>{{ email }}</strong>? Comments, reviews and the rest made from that account will
          be recorded as you, and the link is committed to the tracker's settings, where anybody who
          can read the repository can see it.
        </p>
        <div class="flex gap-2">
          <UButton
            :loading="linking.loading.value"
            icon="i-lucide-link"
            data-testid="discord-link-confirm"
            @click="confirm"
          >
            Link it
          </UButton>
          <UButton color="neutral" variant="ghost" to="/">Not now</UButton>
        </div>
      </div>

      <div v-else-if="link" class="space-y-3">
        <p data-testid="discord-current-link">
          The Discord account <strong>{{ link.username ?? link.userId }}</strong> acts as you.
        </p>
        <UButton
          color="neutral"
          variant="subtle"
          icon="i-lucide-unlink"
          :loading="unlinking.loading.value"
          data-testid="discord-unlink"
          @click="unlink"
        >
          Unlink it
        </UButton>
      </div>

      <p v-else class="text-sm text-muted" data-testid="discord-no-link">
        No Discord account is linked to you. Type <code>/nav link</code> in Discord, and follow the
        link it gives you.
      </p>
    </template>
  </div>
</template>
