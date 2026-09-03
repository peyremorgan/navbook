<!--
  A Markdown body, rendered and sanitised.

  This is the only component that uses `v-html`, and `app/utils/markdown.ts` is
  the only thing that produces HTML from data — a body comes out of a
  repository anyone with a checkout can write to, so it is untrusted in the
  ordinary sense. Keeping both to one place is what makes the rule checkable.
-->
<script setup lang="ts">
import { renderMarkdown } from "~/utils/markdown";

const props = defineProps<{ source: string }>();
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <div v-if="props.source.trim() === ''" class="text-sm italic text-muted">No description.</div>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else class="nav-markdown" v-html="html" />
</template>

<style>
/*
 * Not scoped: the markup is inserted as a string, so it carries none of the
 * attributes a scoped rule matches on.
 */
.nav-markdown { line-height: 1.65; overflow-wrap: anywhere; }
.nav-markdown > * + * { margin-top: 0.75rem; }
.nav-markdown h1, .nav-markdown h2, .nav-markdown h3 { font-weight: 600; line-height: 1.3; }
.nav-markdown h1 { font-size: 1.25rem; }
.nav-markdown h2 { font-size: 1.125rem; }
.nav-markdown h3 { font-size: 1rem; }
.nav-markdown a { color: var(--ui-primary); text-decoration: underline; }
.nav-markdown ul, .nav-markdown ol { padding-inline-start: 1.5rem; }
.nav-markdown ul { list-style: disc; }
.nav-markdown ol { list-style: decimal; }
.nav-markdown li + li { margin-top: 0.25rem; }
.nav-markdown code {
  font-family: ui-monospace, monospace; font-size: 0.875em;
  background: var(--ui-bg-elevated); padding: 0.1em 0.35em; border-radius: 0.25rem;
}
.nav-markdown pre {
  background: var(--ui-bg-elevated); padding: 0.75rem; border-radius: 0.375rem; overflow-x: auto;
}
.nav-markdown pre code { background: none; padding: 0; }
.nav-markdown blockquote {
  border-inline-start: 3px solid var(--ui-border-accented);
  padding-inline-start: 0.75rem; color: var(--ui-text-muted);
}
.nav-markdown table { border-collapse: collapse; display: block; overflow-x: auto; }
.nav-markdown th, .nav-markdown td {
  border: 1px solid var(--ui-border); padding: 0.35rem 0.6rem; text-align: start;
}
.nav-markdown hr { border: 0; border-top: 1px solid var(--ui-border); }
</style>
