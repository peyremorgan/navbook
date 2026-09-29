/**
 * The pure parts of the layer: what an outcome looks like, what a row's `ext`
 * says, how a run's links to its attachments are shown, and how a runner's
 * draft relates to what the server holds.
 *
 * Free of Vue and Nuxt, so `node --test` can check them, as `@navbook/
 * plugin-kb` checks its own utilities.
 */

/** An outcome or tested state, in the lowercase the format and the CLI spell it. */
export type State =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "incomplete"
  | "in-progress"
  | "none"
  | "not-run";

/** The SDL's `IN_PROGRESS` as the format's `in-progress`; null stays not run. */
export function stateOf(value: string | null | undefined): State {
  if (value === null || value === undefined || value === "") return "not-run";
  return value.toLowerCase().replace("_", "-") as State;
}

/** How a state reads, and which of the theme's colours it takes. */
export function stateLook(state: State): {
  label: string;
  color: "success" | "error" | "warning" | "neutral" | "info";
  icon: string;
} {
  switch (state) {
    case "passed":
      return { label: "Passed", color: "success", icon: "i-lucide-circle-check" };
    case "failed":
      return { label: "Failed", color: "error", icon: "i-lucide-circle-x" };
    case "blocked":
      return { label: "Blocked", color: "warning", icon: "i-lucide-circle-slash" };
    case "skipped":
      return { label: "Skipped", color: "neutral", icon: "i-lucide-circle-arrow-right" };
    case "incomplete":
      return { label: "Incomplete", color: "warning", icon: "i-lucide-circle-dashed" };
    case "in-progress":
      return { label: "In progress", color: "info", icon: "i-lucide-circle-play" };
    case "none":
      return { label: "Not tested", color: "neutral", icon: "i-lucide-circle-dashed" };
    default:
      return { label: "Not run", color: "neutral", icon: "i-lucide-circle" };
  }
}

/** The tested states the pull request filter offers, as the API and the address take them. */
export const TESTED_STATES = [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "incomplete",
  "in-progress",
  "none",
] as const;

/** What `Entity.ext.tests` says about a pull request, read defensively. */
export interface TestsExt {
  tested: State;
  runs: number;
}

/**
 * This plugin's slice of a row's `ext`, or null when it has none.
 *
 * `ext` is a JSON scalar: a client built with this layer against an API
 * without the plugin gets no key at all, and must draw nothing rather than
 * break the row.
 */
export function readTestsExt(ext: Record<string, unknown> | null | undefined): TestsExt | null {
  const slice = ext?.tests;
  if (typeof slice !== "object" || slice === null) return null;
  const { tested, runs } = slice as Record<string, unknown>;
  if (typeof tested !== "string" || !(TESTED_STATES as readonly string[]).includes(tested))
    return null;
  return { tested: tested as State, runs: typeof runs === "number" && runs >= 0 ? runs : 0 };
}

/**
 * A run's text with links to its own attachments made into plain markers.
 *
 * The links are relative to the run's file (`<stamp>-<id>/shot.png`), which a
 * forge resolves and a browser on this app would not: it would ask the web
 * server for the file and draw a broken image. The attachments are shown
 * beside the text instead, fetched through the API, and the marker says which
 * one the text meant.
 */
export function markAttachments(text: string, runPath: string): string {
  const base = (runPath.split("/").pop() ?? "").replace(/\.md$/, "");
  if (base === "") return text;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = new RegExp(`!?\\[([^\\]]*)\\]\\(<?(?:\\./)?${escaped}/([^)\\s>]+)>?\\)`, "g");
  return text.replace(link, (_match, _label: string, name: string) => `📎 \`${decodeName(name)}\``);
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** One step's answer in a runner's draft. */
export interface DraftStep {
  status: "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED";
  actual: string;
}

/** What a runner holds that the server may not have yet. */
export interface RunDraft {
  /** The run file's hash the draft was made against. */
  baseSha: string;
  steps: Record<number, DraftStep>;
  notes: string;
}

/** What the server says a run recorded, as a runner would draft it. */
export function draftFromRun(run: {
  baseSha: string;
  notes: string;
  results: readonly { number: number; status?: string | null; actual?: string | null }[];
}): RunDraft {
  const steps: Record<number, DraftStep> = {};
  for (const result of run.results) {
    if (!result.status) continue;
    steps[result.number] = {
      status: result.status as DraftStep["status"],
      actual: result.actual ?? "",
    };
  }
  return { baseSha: run.baseSha, steps, notes: run.notes };
}

/** The steps a draft changes relative to the server, in plan order: what a save sends. */
export function changedSteps(
  draft: RunDraft,
  saved: RunDraft,
): { number: number; status: DraftStep["status"]; actual: string | null }[] {
  return Object.entries(draft.steps)
    .map(([number, step]) => ({ number: Number(number), step }))
    .filter(({ number, step }) => {
      const before = saved.steps[number];
      return (
        before === undefined ||
        before.status !== step.status ||
        before.actual.trim() !== step.actual.trim()
      );
    })
    .sort((a, b) => a.number - b.number)
    .map(({ number, step }) => ({
      number,
      status: step.status,
      actual: step.actual.trim() === "" ? null : step.actual.trim(),
    }));
}

/** True when a draft holds something the server does not. */
export function draftDiffers(draft: RunDraft, saved: RunDraft): boolean {
  return changedSteps(draft, saved).length > 0 || draft.notes.trim() !== saved.notes.trim();
}

/** Where a runner keeps its draft between reloads: one key per run. */
export function draftKey(runId: string): string {
  return `navbook:tests:draft:${runId}`;
}

/** A stored draft, or null when there is none or it does not parse. */
export function parseDraft(text: string | null): RunDraft | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<RunDraft>;
    if (typeof value.baseSha !== "string" || typeof value.notes !== "string") return null;
    if (typeof value.steps !== "object" || value.steps === null) return null;
    const steps: Record<number, DraftStep> = {};
    for (const [key, step] of Object.entries(value.steps)) {
      const number = Number(key);
      const status = (step as DraftStep | undefined)?.status;
      if (!Number.isInteger(number) || number < 1) continue;
      if (
        status !== "PASSED" &&
        status !== "FAILED" &&
        status !== "BLOCKED" &&
        status !== "SKIPPED"
      )
        continue;
      const actual = (step as DraftStep).actual;
      steps[number] = { status, actual: typeof actual === "string" ? actual : "" };
    }
    return { baseSha: value.baseSha, notes: value.notes, steps };
  } catch {
    return null;
  }
}

/** A file read in the browser, as `attachToTestRun` takes it: base64 without the `data:` prefix. */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/** True for a name a browser can draw as a picture. */
export function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name);
}

/** Share of finished runs that passed, as a whole percentage; null with none finished. */
export function passRate(stats: {
  runs: number;
  passed: number;
  inProgress: number;
}): number | null {
  const finished = stats.runs - stats.inProgress;
  return finished <= 0 ? null : Math.round((stats.passed / finished) * 100);
}
