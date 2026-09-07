<!--
  Nothing lives at the root: issues are what people come for. The open ones,
  since a listing naming no status means any status, and a bare `/issues` would
  open on the closed ones mixed in with the rest.

  The filter is asked for here rather than made the listing's default, so that
  `/issues` still means everything and Clear still gets it back.

  The path is written out rather than imported from `HOME`, which holds the same
  string. Nuxt lifts `redirect` into the vue-router route record only when its
  value is statically serializable; an imported identifier is classified dynamic
  instead and never reaches the record — which is where a redirect has to be by
  the time the route is matched. So the two are kept in step by hand, and the
  end-to-end test that walks in through `/` is what notices if they drift.
-->
<script setup lang="ts">
definePageMeta({ redirect: "/issues?status=open" });
</script>

<template>
  <div />
</template>
