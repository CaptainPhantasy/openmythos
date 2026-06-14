import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { OpenMythosConfig } from "../config/schema.js";
import type { FileEdit, ReviewBundle, EditReview, TaskToolRequest } from "./types.js";
import { normalizeUnifiedPatch } from "../tools/files.js";

const RISK_ORDER: Record<EditReview["risk"]["level"], number> = {
  low: 1,
  medium: 2,
  high: 3
};

export class ApprovalRequiredError extends Error {
  constructor(
    readonly taskId: string,
    readonly review: ReviewBundle
  ) {
    super(
      `Approval required for task ${taskId}. Review artifacts: ${review.reviewPath}, ${review.patchPath}`
    );
  }
}

export interface ToolApprovalPayload {
  taskId: string;
  tool: TaskToolRequest["tool"];
  mode: OpenMythosConfig["approval"]["mode"];
  reason: string;
  request: TaskToolRequest;
  artifactPath: string;
}

export class ToolApprovalRequiredError extends Error {
  constructor(readonly payload: ToolApprovalPayload) {
    super(`Approval required for task ${payload.taskId}: ${payload.reason}`);
  }
}

export async function createReviewBundle(
  workdir: string,
  runDir: string,
  taskId: string,
  edits: FileEdit[],
  approval: OpenMythosConfig["approval"]
): Promise<ReviewBundle> {
  const reviews: EditReview[] = [];
  const patchParts: string[] = [];

  for (const edit of edits) {
    const target = resolve(workdir, edit.path);
    const beforeExists = existsSync(target);
    const beforeContent = beforeExists && edit.action !== "create"
      ? await readFile(target, "utf8")
      : "";

    const review = assessEditRisk(edit, approval, beforeExists);
    reviews.push(review);
    patchParts.push(renderPatch(edit.path, edit.action, beforeContent, edit.content));
  }

  const highestRisk = reviews.reduce<ReviewBundle["highestRisk"]>((highest, review) => {
    return RISK_ORDER[review.risk.level] > RISK_ORDER[highest] ? review.risk.level : highest;
  }, "low");

  const blocking = approval.mode === "enforce" && reviews.some((review) => review.risk.level === "high");
  const reviewFile = resolve(runDir, `review-${taskId}.json`);
  const patchFile = resolve(runDir, `review-${taskId}.patch`);

  await mkdir(dirname(reviewFile), { recursive: true });
  await writeFile(reviewFile, JSON.stringify({
    taskId,
    highestRisk,
    blocking,
    reviews
  }, null, 2));
  await writeFile(patchFile, `${patchParts.join("\n")}\n`, "utf8");

  return {
    taskId,
    patchPath: patchFile,
    reviewPath: reviewFile,
    highestRisk,
    blocking,
    reviews
  };
}

function assessEditRisk(
  edit: FileEdit,
  approval: OpenMythosConfig["approval"],
  beforeExists: boolean
): EditReview {
  const reasons: string[] = [];

  if (edit.action === "delete") {
    reasons.push("delete action");
  }

  if (approval.dependencyManifestPaths.includes(edit.path)) {
    reasons.push("dependency manifest touched");
  }

  if (approval.protectedPaths.some((pattern) => matchesPath(edit.path, pattern))) {
    reasons.push("protected path matched");
  }

  if (approval.highRiskExtensions.some((extension) => edit.path.endsWith(extension))) {
    reasons.push("high-risk file extension");
  }

  if (approval.secretPatterns.some((pattern) => matchesContent(edit.content, pattern))) {
    reasons.push("secret-like content detected");
  }

  if (edit.path.startsWith(".")) {
    reasons.push("hidden root path");
  }

  if (edit.action === "create" && !beforeExists && edit.content.length > 20000) {
    reasons.push("large new file");
  }

  const level: EditReview["risk"]["level"] = reasons.some((reason) =>
    reason === "delete action" ||
    reason === "protected path matched" ||
    reason === "high-risk file extension" ||
    reason === "secret-like content detected"
  )
    ? "high"
    : reasons.length > 0
      ? "medium"
      : "low";

  return {
    path: edit.path,
    action: edit.action,
    description: edit.description,
    risk: {
      level,
      reasons
    },
    beforeExists
  };
}

function renderPatch(path: string, action: FileEdit["action"], before: string, after: string): string {
  if (action === "patch") {
    return normalizeUnifiedPatch(path, after);
  }
  const beforeLines = splitLines(before);
  const afterLines = splitLines(action === "delete" ? "" : after);
  const fromPath = action === "create" ? "/dev/null" : `a/${path}`;
  const toPath = action === "delete" ? "/dev/null" : `b/${path}`;
  const hunkHeader = `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`;

  return [
    `diff --git ${fromPath} ${toPath}`,
    `--- ${fromPath}`,
    `+++ ${toPath}`,
    hunkHeader,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join("\n");
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function matchesPath(path: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\0/g, ".*");
    return new RegExp(`^${escaped}$`).test(path);
  }
  return path === pattern;
}

function matchesContent(content: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "m").test(content);
  } catch {
    return content.includes(pattern);
  }
}
