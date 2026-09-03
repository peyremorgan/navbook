<!--
  The frame every page sits in: where you are, who you are, and nothing else.
-->
<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { VIEWER_QUERY } from "~/graphql/queries";

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
];
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <header class="border-b border-default bg-elevated/40">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <NuxtLink to="/issues" class="flex items-center gap-2 font-semibold">
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

        <div class="ms-auto">
          <UDropdownMenu
            v-if="viewer"
            :items="[[
              { label: viewer.email, type: 'label' as const },
              { label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => auth.logout() },
            ]]"
          >
            <UButton color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-chevron-down">
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
