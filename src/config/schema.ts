import { z } from "zod";

export const modelRoleSchema = z.enum([
  "planner",
  "compressor",
  "coder",
  "critic",
  "verifier",
  "researcher",
  "tester",
  "refactorer",
  "documenter"
]);

export type ModelRole = z.infer<typeof modelRoleSchema>;

export const adapterSchema = z.enum([
  "anthropic",
  "openai",
  "openai-compatible",
  "glm",
  "zai-coding",
  "fake"
]);

export const thinkingConfigSchema = z.object({
  type: z.enum(["enabled", "disabled"]).default("enabled"),
  clearThinking: z.boolean().default(true)
}).default({});

export const rateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().positive()
}).optional();

export const approvalModeSchema = z.enum(["off", "suggest", "enforce"]);
export const governanceModeSchema = z.enum(["allow", "warn", "block"]);

export const approvalConfigSchema = z.object({
  mode: approvalModeSchema.default("off"),
  protectedPaths: z.array(z.string()).default([]),
  highRiskExtensions: z.array(z.string()).default([
    ".pem",
    ".key",
    ".p12",
    ".crt"
  ]),
  dependencyManifestPaths: z.array(z.string()).default([
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "pyproject.toml",
    "requirements.txt",
    "poetry.lock"
  ]),
  secretPatterns: z.array(z.string()).default([
    "sk-[A-Za-z0-9_-]{12,}",
    "ghp_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "AIza[0-9A-Za-z\\-_]{20,}",
    "AKIA[0-9A-Z]{16}",
    "-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
  ])
}).default({});

const verificationPresetsSchema = z.object({
  default: z.array(z.string()).default([]),
  byTaskType: z.record(z.array(z.string())).default({
    lint: ["npm run --if-present lint"],
    build: ["npm run --if-present build"],
    test: ["npm run --if-present test"],
    browser: ["npm run --if-present test"],
    api: ["npm run --if-present test"],
    database: ["npm run --if-present test"],
    security: ["npm run --if-present audit"],
    performance: ["npm run --if-present build"]
  }),
  byRisk: z.object({
    low: z.array(z.string()).default([]),
    medium: z.array(z.string()).default(["npm run --if-present test"]),
    high: z.array(z.string()).default(["npm run --if-present test", "npm run --if-present build"])
  }).default({})
}).default({});

export const governanceConfigSchema = z.object({
  requireGitRepo: z.boolean().default(false),
  dirtyWorktree: governanceModeSchema.default("warn"),
  protectedBranchMode: governanceModeSchema.default("warn"),
  protectedBranches: z.array(z.string()).default([
    "main",
    "master",
    "release/*"
  ])
}).default({});

export const modelConfigSchema = z.object({
  adapter: adapterSchema,
  model: z.string().min(1),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.2),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(120000),
  thinking: thinkingConfigSchema,
  rateLimit: rateLimitConfigSchema
});

export const openMythosConfigSchema = z.object({
  models: z.object({
    planner: modelConfigSchema,
    compressor: modelConfigSchema,
    coder: modelConfigSchema,
    critic: modelConfigSchema,
    verifier: modelConfigSchema
  }),
  execution: z.object({
    maxRetries: z.number().int().min(0).default(3),
    maxTaskToolTurns: z.number().int().min(0).default(3),
    timeoutMs: z.number().int().positive().default(120000),
    workingDirectory: z.string().default(".")
  }).default({}),
  context: z.object({
    maxFiles: z.number().int().positive().default(80),
    maxFileSizeBytes: z.number().int().positive().default(120000),
    ignorePatterns: z.array(z.string()).default([]),
    ignoreExtensions: z.array(z.string()).default([])
  }).default({}),
  verification: z.object({
    localCommands: z.array(z.string()).default([]),
    requireLocalPassBeforeModelQa: z.boolean().default(true),
    presets: verificationPresetsSchema
  }).default({}),
  approval: approvalConfigSchema,
  governance: governanceConfigSchema,
  routing: z.object({
    policies: z.array(z.object({
      taskType: z.string(),
      preferredRole: z.string(),
      fallbackRole: z.string().optional(),
      maxLatencyMs: z.number().optional(),
      maxCostCents: z.number().optional(),
    })).default([]),
    defaultComplexityThreshold: z.object({
      trivial: z.number().default(50),
      standard: z.number().default(500),
      complex: z.number().default(2000),
    }).default({}),
  }).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    persistNotes: z.boolean().default(true),
    persistDecisions: z.boolean().default(true),
    maxNotes: z.number().default(100),
  }).default({}),
  worktree: z.object({
    enabled: z.boolean().default(false),
    autoCleanup: z.boolean().default(true),
    basePath: z.string().default(".openmythos/worktrees"),
  }).default({}),
  guardrails: z.object({
    secretScan: z.boolean().default(true),
    dependencyAudit: z.boolean().default(true),
    destructiveBlock: z.boolean().default(true),
    customSecretPatterns: z.array(z.string()).default([]),
  }).default({})
});

export type OpenMythosConfig = z.infer<typeof openMythosConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
