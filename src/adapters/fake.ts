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
      const successCriteria = harnessStatusAction
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
        dependencies: verifierRouting || harnessExecutor ? { "task-2": ["task-1"] } : {},
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
        errors: []
      };
    }

    if (request.system.includes("implement one planned task") || request.system.includes("review and correct one planned task")) {
      const taskId = request.messages.some((message) => message.content.includes('"id": "task-2"')) ? "task-2" : "task-1";
      return {
        taskId,
        status: "success",
        fileEdits: taskId === "task-2"
          ? []
          : [
              {
                path: "openmythos-fake-output.txt",
                action: "create",
                content: "OPENMYTHOS_FAKE_SUCCESS\n",
                description: "Create deterministic success marker"
              }
            ],
        summary: taskId === "task-2"
          ? "Reviewed deterministic fake output marker."
          : "Created deterministic fake output marker.",
        errors: []
      };
    }

    if (request.system.includes("final QA gate")) {
      const harnessStatusAction = request.messages.some((message) => message.content.includes("Inspect git status via harness action"));
      return {
        passed: true,
        score: 100,
        issues: [],
        suggestions: [],
        verifiedCriteria: harnessStatusAction
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
