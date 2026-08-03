/**
 * `nav doctor` — spec 04 §4.3.
 *
 * Doctor enforces the specification, not a house style: hand edits that are
 * unusual but valid must pass. Errors (exit 2) are format violations; warnings
 * (exit 0) are things worth a look that may be perfectly deliberate. Deciding
 * which is which is `core`'s job; deciding what an exit code is, is this file's.
 */

import { type Diagnostic, hasErrors, NAVBOOK_ROOT, runDoctor } from "@navbook/core";
import type { Ctx } from "../context.ts";
import { NavError } from "../errors.ts";

export interface DoctorOptions {
  staged?: boolean;
  fix?: boolean;
  json?: boolean;
}

export function cmdDoctor(ctx: Ctx, opts: DoctorOptions): void {
  const { diagnostics, applied } = runDoctor(ctx, { staged: opts.staged, fix: opts.fix });

  if (opts.json) {
    for (const diagnostic of diagnostics) {
      ctx.stdout.write(`${JSON.stringify(toJson(diagnostic))}\n`);
    }
  } else {
    report(ctx, diagnostics, applied);
  }

  if (hasErrors(diagnostics)) {
    throw new NavError(`${countErrors(diagnostics)} format violation(s) found`, { exitCode: 2 });
  }
}

function toJson(diagnostic: Diagnostic): Record<string, unknown> {
  return {
    check: diagnostic.check,
    level: diagnostic.level,
    path: diagnostic.path === "" ? "" : `${NAVBOOK_ROOT}/${diagnostic.path}`,
    message: diagnostic.message,
  };
}

function report(ctx: Ctx, diagnostics: readonly Diagnostic[], applied: readonly string[]): void {
  const c = ctx.colors;
  for (const line of applied) ctx.stdout.write(`${c.green("fixed")}  ${line}\n`);

  for (const diagnostic of diagnostics) {
    const level = diagnostic.level === "error" ? c.red("error") : c.yellow("warning");
    const where = diagnostic.path === "" ? "" : `${NAVBOOK_ROOT}/${diagnostic.path}: `;
    ctx.stdout.write(`${level}  ${c.dim(diagnostic.check)}  ${where}${diagnostic.message}\n`);
  }

  const errors = countErrors(diagnostics);
  const warnings = diagnostics.length - errors;
  if (errors === 0 && warnings === 0) {
    ctx.stdout.write(applied.length > 0 ? "No problems remain.\n" : "No problems found.\n");
    return;
  }
  ctx.stdout.write(`${plural(errors, "error")}, ${plural(warnings, "warning")}\n`);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function countErrors(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((d) => d.level === "error").length;
}
