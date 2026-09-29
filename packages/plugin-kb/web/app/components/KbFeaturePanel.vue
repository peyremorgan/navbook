<!--
  The features an entity belongs to, as an editor on its detail page.

  Registered as a panel, and drawn with the host's own `LabelEditor` — the same
  component the milestone and the assignees use — so it reads and behaves like
  a field of the format rather than like something bolted on. `linkTo` is what
  makes these chips lead somewhere: features are real directories with a page,
  which labels and milestones are not.

  The save goes out through the host's `updateIssue` / `updatePr`, because the
  field is one this plugin's SDL added to their inputs. So attaching a feature
  from here is one commit to one file, and it is guarded, reported and retried
  exactly as editing the title is.
-->
<script setup lang="ts">
import type { FieldSave } from "~/composables/usePendingEdits";
import type { EntityEdit } from "~/utils/patch";

const props = defineProps<{
  /** The entity as the page shows it, pending edits already laid over it. */
  entity: EntityEdit;
  /**
   * Whether any save on the page is in flight.
   *
   * Declared and not read: `fieldSave` says what this field needs, and a prop
   * a component does not declare is passed through onto its root element —
   * which would put `saving="false"` into the rendered HTML.
   */
  saving: boolean;
  /** The save covering plugin fields, so this reads as a built-in editor does. */
  fieldSave?: FieldSave;
  /**
   * Set when the server cannot take the write at all — a pull request whose
   * branch it does not hold — so the chips read but are not offered for
   * editing, as the milestone's beside them are not.
   */
  disabled?: boolean;
}>();

const emit = defineEmits<{ save: [Partial<EntityEdit>] }>();

const { slugs } = useKbFeatures();
const values = computed(() => props.entity.ext.features ?? []);

// The whole map, not just this key: two plugins' panels editing one entity
// must not clear each other, and the host lays a change over the edit whole.
function save(features: string[]): void {
  emit("save", { ext: { ...props.entity.ext, features } });
}
</script>

<template>
  <LabelEditor
    title="Features"
    icon="i-lucide-layers"
    testid="features"
    link-to="/features/"
    :values="values"
    :suggestions="slugs"
    :save="props.fieldSave"
    :disabled="props.disabled"
    @save="save"
  />
</template>
