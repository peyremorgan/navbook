<!--
  Linking a Discord account to the signed-in person — the page `/nav link`
  sends somebody to, with a one-time code.

  The code is not redeemed by opening the page: a link is followed by
  previews and by people who were sent it, and a code works once. The page
  names the Discord account that asked for the code — its display name and
  its handle, which nobody else's can copy — and asks. A code somebody else
  sent you is theirs, and linking it would let their account act as you; the
  page says so. Without a code it shows every account linked to you, and
  undoes them.
-->
<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { describeApiError, sayFailure } from "~/utils/errors";
import { pageTitle } from "~/utils/title";
import { LINK_DISCORD, UNLINK_DISCORD } from "../../graphql/mutations";
import { DISCORD_LINK_QUERY, DISCORD_PENDING_QUERY } from "../../graphql/queries";

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
const links = computed(() => result.value?.viewer.discord ?? []);

const pendingQuery = useQuery(
  DISCORD_PENDING_QUERY,
  () => ({ code: code.value ?? "" }),
  () => ({ enabled: code.value !== null, fetchPolicy: "network-only", errorPolicy: "all" }),
);
const pending = computed(() => pendingQuery.result.value?.discord?.pending ?? null);

/** An account as a person recognises it: its name, and its handle. */
function describe(link: { userId: string; username?: string | null; handle?: string | null }) {
  const name = link.username ?? link.handle ?? link.userId;
  return link.handle && link.handle !== name ? `${name} (@${link.handle})` : name;
}

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
    linked.value = payload.link ? describe(payload.link) : "your account";
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

      <template v-else-if="code">
        <p v-if="pendingQuery.loading.value && !pending" class="text-sm text-muted">Loading…</p>
        <div v-else-if="pending" class="space-y-3" data-testid="discord-link-ask">
          <p>
            Link the Discord account
            <strong data-testid="discord-pending-account">{{ describe(pending) }}</strong> to
            <strong>{{ email }}</strong>? Comments, reviews and the rest made from that account will
            be recorded as you, and the link is committed to the tracker's settings, where anybody
            who can read the repository can see it.
          </p>
          <p class="text-sm text-muted">
            Only link an account that is yours. If somebody sent you this link, it is theirs: linking
            it would let them act as you.
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
        <UAlert
          v-else
          color="warning"
          icon="i-lucide-circle-alert"
          title="This link code is unknown or has expired"
          description="Codes work once, for ten minutes. Type /nav link in Discord for a new one."
          data-testid="discord-code-dead"
        />
      </template>

      <div v-else-if="links.length > 0" class="space-y-3">
        <p data-testid="discord-current-link">
          {{ links.length === 1 ? "This Discord account acts" : "These Discord accounts act" }} as
          you:
          <template v-for="(each, index) in links" :key="each.userId">
            <strong>{{ describe(each) }}</strong><span v-if="index < links.length - 1">, </span>
          </template>
        </p>
        <UButton
          color="neutral"
          variant="subtle"
          icon="i-lucide-unlink"
          :loading="unlinking.loading.value"
          data-testid="discord-unlink"
          @click="unlink"
        >
          Unlink {{ links.length === 1 ? "it" : "them" }}
        </UButton>
      </div>

      <p v-else class="text-sm text-muted" data-testid="discord-no-link">
        No Discord account is linked to you. Type <code>/nav link</code> in Discord, and follow the
        link it gives you.
      </p>
    </template>
  </div>
</template>
