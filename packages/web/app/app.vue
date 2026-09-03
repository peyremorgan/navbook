<!--
  The application shell.

  Everything below it needs the runtime config, an identity and an Apollo
  client, all three of which the plugins in `app/plugins/` install before the
  first route renders. `UApp` is what gives `useToast()` and `useOverlay()`
  somewhere to render, so it wraps the whole tree rather than the layout.
-->
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
