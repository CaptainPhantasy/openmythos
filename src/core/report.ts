import type { Plan, QaResult, TaskOutput } from "./types.js";

export function buildFinalReport(goal: string, plan: Plan, outputs: TaskOutput[], qa: QaResult | null): string {
  const lines: string[] = [];
  lines.push("# OpenMythos Execution Report");
  lines.push("");
  lines.push("## Goal");
  lines.push(goal);
  lines.push("");
  lines.push("## Plan");
  for (const task of plan.tasks) {
    lines.push(`- ${task.id}: ${task.title} (${task.role})`);
  }
  lines.push("");
  lines.push("## Outputs");
  for (const output of outputs) {
    lines.push(`### ${output.taskId}: ${output.status}`);
    lines.push(output.summary);
    for (const edit of output.fileEdits) {
      lines.push(`- ${edit.action} ${edit.path}: ${edit.description}`);
    }
    if (output.errors.length > 0) {
      lines.push(`- errors: ${output.errors.join("; ")}`);
    }
  }
  if (qa) {
    lines.push("");
    lines.push("## QA");
    lines.push(`Passed: ${qa.passed}`);
    lines.push(`Score: ${qa.score}`);
    for (const issue of qa.issues) {
      lines.push(`- [${issue.severity}] ${issue.description}`);
    }
  }
  return lines.join("\n");
}
