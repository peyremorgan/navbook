<!--
  The frame every page sits in: where you are, who you are, and nothing else.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { VIEWER_QUERY } from "~/graphql/queries";
import { HOME } from "~/utils/navigation";

const auth = useAuth();
// Who the *server* thinks is acting, which is the thing worth showing: it is
// the `email` claim it read out of the token, and what it will write as
// `author:`. The token's own claim would agree, but only this has been tested
// against the server that will record it.
const { result } = useQuery(VIEWER_QUERY, null, { fetchPolicy: "cache-first" });
const viewer = computed(() => result.value?.viewer ?? null);

const links = [
  { label: "Issues", to: "/issues", icon: "i-lucide-circle-dot" },
  { label: "Pull requests", to: "/prs", icon: "i-lucide-git-pull-request" },
  { label: "Features", to: "/features", icon: "i-lucide-layers" },
];
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <header class="border-b border-default bg-elevated/40">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <!--
          The wordmark is the way home, so it goes where the root goes: the
          open issues. The button beside it is not — "Issues" means the
          listing, all of it, which is the way back out of the filter.
        -->
        <NuxtLink :to="HOME" class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-notebook-text" class="size-5 text-primary" />
          Navbook
        </NuxtLink>

        <nav class="flex items-center gap-1">
          <UButton
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :icon="link.icon"
            :label="link.label"
            color="neutral"
            :variant="$route.path.startsWith(link.to) ? 'soft' : 'ghost'"
            size="sm"
          />
        </nav>

        <div class="ms-auto flex items-center gap-1">
          <!--
            The theme, which nobody has to set: `@nuxtjs/color-mode` — already
            here as a dependency of Nuxt UI — starts at the `system`
            preference, so the first visit matches whatever the browser says
            about `prefers-color-scheme`. This button is for disagreeing with
            it, and the disagreement is what gets stored.
          -->
          <UColorModeButton data-testid="theme-toggle" size="sm" />

          <!--
            The inbox is here rather than beside the other three, because it is
            not another listing: those are the repository, this is one person's
            reading of it. It belongs with the name it is about.
          -->
          <UDropdownMenu
            v-if="viewer"
            :items="[
              [{ label: viewer.email, type: 'label' as const }],
              [{ label: 'Inbox', icon: 'i-lucide-inbox', to: '/inbox' }],
              [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => auth.logout() }],
            ]"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-chevron-down"
              data-testid="account-menu"
            >
              <UAvatar :alt="viewer.name ?? viewer.email" size="2xs" />
              <span class="hidden sm:inline">{{ viewer.name ?? viewer.email }}</span>
            </UButton>
          </UDropdownMenu>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
