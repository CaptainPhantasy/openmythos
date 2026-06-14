import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import type { ModelAdapter } from "./base.js";

export class FakeAdapter implements ModelAdapter {
  async call(request: AdapterRequest): Promise<AdapterResponse> {
    const started = Date.now();
    const content = JSON.stringify(this.responseFor(request));
    return {
      content,
      model: "fake-openmythos",
      inputTokens: request.messages.reduce((sum, message) => sum + message.content.length, 0),
      outputTokens: content.length,
      durationMs: Date.now() - started
    };
  }

  private responseFor(request: AdapterRequest): Record<string, unknown> {
    if (request.system.includes("classify software work")) {
      const taskSnippetScoping = request.messages.some((message) => message.content.includes("task snippet scoping"));
      if (taskSnippetScoping) {
        return {
          taskType: "feature",
          description: "Create a report using only ALPHA_ONLY repository context.",
          successCriteria: [
            "alpha-report.txt exists",
            "alpha-report.txt contains TASK_SNIPPET_SCOPE_OK"
          ],
          complexity: "low",
          relevantPatterns: ["src/**/*.ts"]
        };
      }
      return {
        taskType: "feature",
        description: "Create a deterministic fake-run output file.",
        successCriteria: [
          "openmythos-fake-output.txt exists",
          "openmythos-fake-output.txt contains the fake adapter success marker"
        ],
        complexity: "low",
        relevantPatterns: ["*.txt", "src/**/*.ts"]
      };
    }

    if (request.system.includes("compress repository context")) {
      const taskSnippetScoping = request.messages.some((message) =>
        message.content.includes("task snippet scoping") || message.content.includes("ALPHA_ONLY")
      );
      if (taskSnippetScoping) {
        return {
          fileManifest: ["src/alpha.ts", "src/beta.ts"],
          summary: "Repository context includes alpha and beta source files.",
          relevantSnippets: {
            "src/alpha.ts": "export const alpha = 'ALPHA_ONLY';",
            "src/beta.ts": "export const beta = 'BETA_ONLY';"
          },
          tokenEstimate: 32
        };
      }
      return {
        fileManifest: [],
        summary: "No project context is required for the deterministic fake run.",
        relevantSnippets: {},
        tokenEstimate: 0
      };
    }

    if (request.system.includes("create deterministic execution plans")) {
      const failingVerification = request.messages.some((message) => message.content.includes("failing task verification"));
      const aliasTools = request.messages.some((message) => message.content.includes("alias tool normalization"));
      const verifierRouting = request.messages.some((message) => message.content.includes("verifier task routing"));
      const harnessExecutor = request.messages.some((message) => message.content.includes("harness task execution"));
      const harnessStatusAction = request.messages.some((message) => message.content.includes("harness git status action"));
      const taskScopedRetrieval = request.messages.some((message) => message.content.includes("task scoped retrieval"));
      const modelToolLoop = request.messages.some((message) => message.content.includes("model tool loop"));
      const modelVerificationCommandLoop = request.messages.some((message) => message.content.includes("model verification command loop"));
      const dependencyScopedHandoff = request.messages.some((message) => message.content.includes("dependency scoped handoff"));
      const taskSnippetScoping = request.messages.some((message) => message.content.includes("task snippet scoping"));
      const successCriteria = dependencyScopedHandoff
        ? [
            "handoff-report.txt exists",
            "handoff-report.txt contains DEPENDENCY_HANDOFF_OK"
          ]
        : taskSnippetScoping
          ? [
              "alpha-report.txt exists",
              "alpha-report.txt contains TASK_SNIPPET_SCOPE_OK"
            ]
        : harnessStatusAction
        ? [
            "Git status context is captured",
            "The harness verification command succeeds"
          ]
        : [
            "openmythos-fake-output.txt exists",
            "openmythos-fake-output.txt contains OPENMYTHOS_FAKE_SUCCESS"
          ];
      return {
        goal: "deterministic fake run",
        tasks: harnessStatusAction
          ? [
              {
                id: "task-1",
                title: "Inspect git status via harness action",
                description: "Capture deterministic git status context through the harness executor.",
                role: "verifier",
                executor: "harness",
                harnessAction: "verify.git_status",
                contextQueries: [],
                fileTargets: [],
                requiredTools: ["git.status", "verification.command"],
                verificationCommands: ["test 1 -eq 1"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "Git status context is captured",
                  "The verification command succeeds"
                ]
              }
            ]
          : modelToolLoop
          ? [
              {
                id: "task-1",
                title: "Create fake output marker through model tool loop",
                description: "Request read-only harness tools before producing the final file edit.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["openmythos-fake-output.txt"],
                requiredTools: ["filesystem.search", "filesystem.read", "filesystem.write"],
                verificationCommands: ["test -f openmythos-fake-output.txt", "grep -qx 'OPENMYTHOS_FAKE_SUCCESS' openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              }
            ]
          : taskSnippetScoping
          ? [
              {
                id: "task-1",
                title: "Create alpha-only report",
                description: "Use only ALPHA_ONLY repository snippet context to create the report.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: ["ALPHA_ONLY"],
                fileTargets: ["src/alpha.ts", "alpha-report.txt"],
                requiredTools: ["filesystem.write"],
                verificationCommands: ["test -f alpha-report.txt", "grep -qx 'TASK_SNIPPET_SCOPE_OK' alpha-report.txt"],
                executionMode: "serial",
                acceptanceCriteria: ["alpha-report.txt exists", "alpha-report.txt contains TASK_SNIPPET_SCOPE_OK"]
              }
            ]
          : dependencyScopedHandoff
          ? [
              {
                id: "task-1",
                title: "Create alpha marker",
                description: "Create the alpha marker file for downstream dependent work.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["alpha.txt"],
                requiredTools: ["filesystem.write"],
                verificationCommands: ["test -f alpha.txt"],
                executionMode: "parallel",
                acceptanceCriteria: ["alpha.txt exists"]
              },
              {
                id: "task-2",
                title: "Create beta marker",
                description: "Create the beta marker file that should not be handed to unrelated dependent work.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["beta.txt"],
                requiredTools: ["filesystem.write"],
                verificationCommands: ["test -f beta.txt"],
                executionMode: "parallel",
                acceptanceCriteria: ["beta.txt exists"]
              },
              {
                id: "task-3",
                title: "Create dependency handoff report",
                description: "Use only the declared dependency handoff context to create the final report.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["handoff-report.txt"],
                requiredTools: ["filesystem.write"],
                verificationCommands: ["test -f handoff-report.txt", "grep -qx 'DEPENDENCY_HANDOFF_OK' handoff-report.txt"],
                executionMode: "serial",
                acceptanceCriteria: ["handoff-report.txt exists", "handoff-report.txt contains DEPENDENCY_HANDOFF_OK"]
              }
            ]
          : modelVerificationCommandLoop
          ? [
              {
                id: "task-1",
                title: "Create fake output marker after command-backed verification",
                description: "Request a declared verification command before producing the final file edit.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["src/example.ts", "openmythos-fake-output.txt"],
                requiredTools: ["verification.command", "filesystem.write"],
                verificationCommands: ["grep -qx 'PRECHECK_OK' src/example.ts", "test -f openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The precheck command succeeds",
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              }
            ]
          : taskScopedRetrieval
          ? [
              {
                id: "task-1",
                title: "Create fake output marker with task-scoped retrieval",
                description: "Use deterministic search and symbol context before creating the marker file.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: ["OPENMYTHOS_FAKE_SUCCESS", "locateTarget"],
                fileTargets: ["openmythos-fake-output.txt"],
                requiredTools: ["filesystem.search", "code.symbols", "filesystem.write"],
                verificationCommands: ["test -f openmythos-fake-output.txt", "grep -qx 'OPENMYTHOS_FAKE_SUCCESS' openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              }
            ]
          : (verifierRouting || harnessExecutor)
          ? [
              {
                id: "task-1",
                title: "Create fake output marker",
                description: "Create a file proving the runner applied a model-provided edit.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["openmythos-fake-output.txt"],
                requiredTools: ["filesystem.write"],
                verificationCommands: ["test -f openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              },
              {
                id: "task-2",
                title: "Verify fake output marker",
                description: "Verify the marker file with the verifier worker.",
                role: "verifier",
                executor: harnessExecutor ? "harness" : "model",
                harnessAction: harnessExecutor ? "verify.file_state" : null,
                contextQueries: [],
                fileTargets: ["openmythos-fake-output.txt"],
                requiredTools: harnessExecutor
                  ? ["filesystem.read", "verification.command"]
                  : ["filesystem.read", "verification.command"],
                verificationCommands: ["grep -qx 'OPENMYTHOS_FAKE_SUCCESS' openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              }
            ]
          : [
              {
                id: "task-1",
                title: "Create fake output marker",
                description: "Create a file proving the runner applied a model-provided edit.",
                role: "coder",
                executor: "model",
                harnessAction: null,
                contextQueries: [],
                fileTargets: ["openmythos-fake-output.txt"],
                requiredTools: aliasTools ? ["write", "bash"] : ["filesystem.write"],
                verificationCommands: failingVerification
                  ? ["test -f openmythos-fake-output.txt", "test -f definitely-missing-task-verification.txt"]
                  : ["test -f openmythos-fake-output.txt", "grep -qx 'OPENMYTHOS_FAKE_SUCCESS' openmythos-fake-output.txt"],
                executionMode: "serial",
                acceptanceCriteria: [
                  "The file exists",
                  "The file contains OPENMYTHOS_FAKE_SUCCESS"
                ]
              }
            ],
        dependencies: dependencyScopedHandoff
          ? { "task-3": ["task-1"] }
          : verifierRouting || harnessExecutor
            ? { "task-2": ["task-1"] }
            : {},
        successCriteria
      };
    }

    if (request.system.includes("verify one planned task during execution")) {
      const taskId = request.messages.some((message) => message.content.includes('"id": "task-2"')) ? "task-2" : "task-1";
      return {
        taskId,
        status: "success",
        fileEdits: [],
        summary: taskId === "task-2"
          ? "Verified deterministic fake output marker."
          : "Verifier confirmed the planned task state.",
        errors: [],
        toolRequests: []
      };
    }

    if (request.system.includes("implement one planned task") || request.system.includes("review and correct one planned task")) {
      const modelToolLoop = request.messages.some((message) => message.content.includes("Create fake output marker through model tool loop"));
      const modelVerificationCommandLoop = request.messages.some((message) => message.content.includes("Create fake output marker after command-backed verification"));
      const dependencyHandoffReport = request.messages.some((message) => message.content.includes("Create dependency handoff report"));
      const taskSnippetScoping = request.messages.some((message) => message.content.includes("Create alpha-only report"));
      const hasToolResults = request.messages.some((message) => message.content.includes("Tool results for the previous request:"));
      const taskId = request.messages.some((message) => message.content.includes('"id": "task-3"'))
        ? "task-3"
        : request.messages.some((message) => message.content.includes('"id": "task-2"'))
          ? "task-2"
          : "task-1";
      if (dependencyHandoffReport) {
        const dependencyOnlyAlpha = request.messages.some((message) =>
          message.content.includes('"taskId": "task-1"')
          && message.content.includes("alpha.txt")
        );
        const leaksBeta = request.messages.some((message) => message.content.includes('"taskId": "task-2"'))
          || request.messages.some((message) => message.content.includes("beta.txt"));
        return {
          taskId,
          status: dependencyOnlyAlpha && !leaksBeta ? "success" : "failed",
          fileEdits: dependencyOnlyAlpha && !leaksBeta
            ? [{
                path: "handoff-report.txt",
                action: "create",
                content: "DEPENDENCY_HANDOFF_OK\n",
                description: "Record that dependency-scoped handoff was correct"
              }]
            : [],
          summary: dependencyOnlyAlpha && !leaksBeta
            ? "Dependency-scoped handoff was limited to the declared upstream task."
            : "Dependency-scoped handoff included unrelated task data.",
          errors: dependencyOnlyAlpha && !leaksBeta ? [] : ["Dependency context was not scoped to the declared upstream tasks."],
          toolRequests: []
        };
      }
      if (taskSnippetScoping) {
        const hasAlphaSnippet = request.messages.some((message) =>
          message.content.includes("src/alpha.ts") && message.content.includes("ALPHA_ONLY")
        );
        const leaksBetaSnippet = request.messages.some((message) =>
          message.content.includes("src/beta.ts") || message.content.includes("BETA_ONLY")
        );
        return {
          taskId,
          status: hasAlphaSnippet && !leaksBetaSnippet ? "success" : "failed",
          fileEdits: hasAlphaSnippet && !leaksBetaSnippet
            ? [{
                path: "alpha-report.txt",
                action: "create",
                content: "TASK_SNIPPET_SCOPE_OK\n",
                description: "Record that task-specific snippet scoping was correct"
              }]
            : [],
          summary: hasAlphaSnippet && !leaksBetaSnippet
            ? "Task-specific snippet context was limited to the relevant alpha file."
            : "Task-specific snippet context leaked unrelated repository snippets.",
          errors: hasAlphaSnippet && !leaksBetaSnippet ? [] : ["Task-specific snippet selection included unrelated repository context."],
          toolRequests: []
        };
      }
      if (modelVerificationCommandLoop && !hasToolResults) {
        return {
          taskId,
          status: "tool",
          fileEdits: [],
          summary: "Need command-backed local evidence before writing the marker file.",
          errors: [],
          toolRequests: [
            {
              tool: "verification.command",
              input: { command: "grep -qx 'PRECHECK_OK' src/example.ts" }
            }
          ]
        };
      }
      if (modelToolLoop && !hasToolResults) {
        return {
          taskId,
          status: "tool",
          fileEdits: [],
          summary: "Need repository search and file read evidence before writing the marker file.",
          errors: [],
          toolRequests: [
            {
              tool: "filesystem.search",
              input: { query: "OPENMYTHOS_FAKE_SUCCESS" }
            },
            {
              tool: "filesystem.read",
              input: { paths: ["src/example.ts"] }
            }
          ]
        };
      }
      return {
        taskId,
        status: "success",
        fileEdits: request.messages.some((message) => message.content.includes("Create alpha marker"))
          ? [
              {
                path: "alpha.txt",
                action: "create",
                content: "ALPHA\n",
                description: "Create alpha marker"
              }
            ]
          : request.messages.some((message) => message.content.includes("Create beta marker"))
            ? [
                {
                  path: "beta.txt",
                  action: "create",
                  content: "BETA\n",
                  description: "Create beta marker"
                }
              ]
            : taskId === "task-2"
              ? []
              : [
                  {
                    path: "openmythos-fake-output.txt",
                    action: "create",
                    content: "OPENMYTHOS_FAKE_SUCCESS\n",
                    description: "Create deterministic success marker"
                  }
                ],
        summary: request.messages.some((message) => message.content.includes("Create alpha marker"))
          ? "Created alpha marker."
          : request.messages.some((message) => message.content.includes("Create beta marker"))
            ? "Created beta marker."
            : taskId === "task-2"
              ? "Reviewed deterministic fake output marker."
              : "Created deterministic fake output marker.",
        errors: [],
        toolRequests: []
      };
    }

    if (request.system.includes("final QA gate")) {
      const harnessStatusAction = request.messages.some((message) => message.content.includes("Inspect git status via harness action"));
      const dependencyScopedHandoff = request.messages.some((message) => message.content.includes("Create dependency handoff report"));
      const taskSnippetScoping = request.messages.some((message) => message.content.includes("Create alpha-only report"));
      return {
        passed: true,
        score: 100,
        issues: [],
        suggestions: [],
        verifiedCriteria: dependencyScopedHandoff
          ? [
              "handoff-report.txt exists",
              "handoff-report.txt contains DEPENDENCY_HANDOFF_OK"
            ]
          : taskSnippetScoping
            ? [
                "alpha-report.txt exists",
                "alpha-report.txt contains TASK_SNIPPET_SCOPE_OK"
              ]
          : harnessStatusAction
          ? [
              "Git status context is captured",
              "The harness verification command succeeds"
            ]
          : [
              "openmythos-fake-output.txt exists",
              "openmythos-fake-output.txt contains OPENMYTHOS_FAKE_SUCCESS"
            ],
        failedCriteria: []
      };
    }

    if (request.system.includes("deterministic code review engine")) {
      return {
        verdict: "clean",
        summary: "No material issues found in the reviewed local changes.",
        findings: [],
        strengths: ["Structured diff and file snapshots were provided."]
      };
    }

    return {};
  }
}
