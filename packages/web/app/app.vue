<!--
  The application shell.

  Everything below it needs the runtime config, an identity and an Apollo
  client, all three of which the plugins in `app/plugins/` install before the
  first route renders. `UApp` is what gives `useToast()` and `useOverlay()`
  somewhere to render, so it wraps the whole tree rather than the layout.
  `LeaveDialog` is the question asked before a navigation discards unsaved
  work, and belongs to no one page (`app/plugins/04.unsaved.ts`).
-->
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <LeaveDialog />
  </UApp>
</template>
