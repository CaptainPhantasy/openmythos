import { z } from "zod";

export const modelRoleSchema = z.enum([
  "planner",
  "compressor",
  "coder",
  "critic",
  "verifier"
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

export const modelConfigSchema = z.object({
  adapter: adapterSchema,
  model: z.string().min(1),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.2),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
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
    requireLocalPassBeforeModelQa: z.boolean().default(true)
  }).default({})
});

export type OpenMythosConfig = z.infer<typeof openMythosConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
