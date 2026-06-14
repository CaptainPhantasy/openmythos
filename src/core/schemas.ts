import { z } from "zod";

const stringListSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return [value];
  }
  return value;
}, z.array(z.string().min(1)));

const snippetRecordSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    const entries: Record<string, string> = {};
    for (const item of value) {
      if (item && typeof item === "object" && "path" in item && "content" in item) {
        const path = (item as { path: unknown }).path;
        const content = (item as { content: unknown }).content;
        if (typeof path === "string" && typeof content === "string") {
          entries[path] = content;
        }
      }
    }
    return entries;
  }
  return value;
}, z.record(z.string()));

const fileManifestSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          for (const key of ["path", "file", "filename", "relativePath"]) {
            if (typeof record[key] === "string") {
              return record[key];
            }
          }
        }
        return null;
      })
      .filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["fileManifest", "files", "manifest"]) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
      if (typeof candidate === "string") {
        return [candidate];
      }
    }
    if (Object.keys(record).length === 0) {
      return [];
    }
  }
  return value;
}, z.array(z.string()));

const tokenEstimateSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  return value;
}, z.coerce.number().int().nonnegative());

const complexitySchema = z.preprocess((value) => {
  if (value === "trivial" || value === "simple" || value === "easy") {
    return "low";
  }
  if (value === "moderate" || value === "normal") {
    return "medium";
  }
  if (value === "complex" || value === "hard") {
    return "high";
  }
  return value;
}, z.enum(["low", "medium", "high"]));

const taskStatusSchema = z.preprocess((value) => {
  if (value === "completed" || value === "complete" || value === "done") {
    return "success";
  }
  return value;
}, z.enum(["success", "partial", "failed"]));

export const intakeSchema = z.object({
  taskType: z.string().min(1),
  description: z.string().min(1),
  successCriteria: stringListSchema.refine((items) => items.length > 0, "Expected at least one success criterion"),
  complexity: complexitySchema,
  relevantPatterns: stringListSchema.default([])
});

export const contextSchema = z.object({
  fileManifest: fileManifestSchema.default([]),
  summary: z.string().min(1).default("No relevant repository context found."),
  relevantSnippets: snippetRecordSchema.default({}),
  tokenEstimate: tokenEstimateSchema.default(0)
});

export const planTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  role: z.enum(["coder", "critic", "verifier"]),
  fileTargets: stringListSchema.default([]),
  acceptanceCriteria: stringListSchema.refine((items) => items.length > 0, "Expected at least one acceptance criterion"),
  requiredTools: stringListSchema.default([]),
  executionMode: z.enum(["parallel", "serial"]).default("serial")
});

export const planSchema = z.object({
  goal: z.string().min(1),
  tasks: z.array(planTaskSchema).min(1),
  dependencies: z.record(stringListSchema).default({}),
  successCriteria: stringListSchema.refine((items) => items.length > 0, "Expected at least one success criterion")
});

export const fileEditSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["create", "modify", "delete", "patch"]),
  content: z.string(),
  description: z.string().min(1).default("Model-provided file edit")
}).superRefine((edit, ctx) => {
  if (edit.action === "patch" && !edit.content.includes("@@")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Patch edits must contain at least one unified-diff hunk header."
    });
  }
});

export const taskOutputSchema = z.object({
  taskId: z.string().min(1),
  status: taskStatusSchema,
  fileEdits: z.array(fileEditSchema).default([]),
  summary: z.string(),
  errors: stringListSchema.default([])
});

export const qaIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  suggestedFix: z.string().optional()
});

export const qaSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(qaIssueSchema),
  suggestions: stringListSchema.default([]),
  verifiedCriteria: stringListSchema.default([]),
  failedCriteria: stringListSchema.default([])
});

export const reviewSchema = z.object({
  verdict: z.enum(["clean", "issues_found"]),
  summary: z.string().min(1),
  findings: z.array(qaIssueSchema).default([]),
  strengths: stringListSchema.default([])
});
