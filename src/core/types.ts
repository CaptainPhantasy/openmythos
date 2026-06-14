import type { ModelRole } from "../config/schema.js";

export type Phase = "intake" | "context" | "plan" | "execute" | "verify" | "complete";

export const PHASES: Phase[] = ["intake", "context", "plan", "execute", "verify", "complete"];

export interface IntakeResult {
  taskType: string;
  description: string;
  successCriteria: string[];
  complexity: "low" | "medium" | "high";
  relevantPatterns: string[];
}

export interface ContextResult {
  fileManifest: string[];
  summary: string;
  relevantSnippets: Record<string, string>;
  tokenEstimate: number;
}

export interface Plan {
  goal: string;
  tasks: PlanTask[];
  dependencies: Record<string, string[]>;
  successCriteria: string[];
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  role: Extract<ModelRole, "coder" | "critic" | "verifier">;
  fileTargets: string[];
  acceptanceCriteria: string[];
  requiredTools: string[];
  executionMode: "parallel" | "serial";
}

export interface FileEdit {
  path: string;
  action: "create" | "modify" | "delete" | "patch";
  content: string;
  description: string;
}

export interface EditRisk {
  level: "low" | "medium" | "high";
  reasons: string[];
}

export interface EditReview {
  path: string;
  action: FileEdit["action"];
  description: string;
  risk: EditRisk;
  beforeExists: boolean;
}

export interface ReviewBundle {
  taskId: string;
  patchPath: string;
  reviewPath: string;
  highestRisk: EditRisk["level"];
  blocking: boolean;
  reviews: EditReview[];
}

export interface TaskOutput {
  taskId: string;
  status: "success" | "partial" | "failed";
  fileEdits: FileEdit[];
  summary: string;
  errors: string[];
}

export interface QaIssue {
  severity: "critical" | "major" | "minor";
  description: string;
  file?: string | undefined;
  line?: number | undefined;
  suggestedFix?: string | undefined;
}

export interface QaResult {
  passed: boolean;
  score: number;
  issues: QaIssue[];
  suggestions: string[];
  verifiedCriteria: string[];
  failedCriteria: string[];
}

export interface ReviewResult {
  verdict: "clean" | "issues_found";
  summary: string;
  findings: QaIssue[];
  strengths: string[];
}

export interface IssueContext {
  source: "local-file" | "github";
  reference: string;
  title: string;
  body: string;
  labels: string[];
  url?: string;
  number?: number;
  repository?: string;
  state?: string;
  author?: string;
}

export interface AdapterMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdapterRequest {
  system: string;
  messages: AdapterMessage[];
  maxTokens: number;
  temperature: number;
  json: boolean;
}

export interface AdapterResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
