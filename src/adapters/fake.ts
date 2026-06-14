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
      return {
        goal: "deterministic fake run",
        tasks: [
          {
            id: "task-1",
            title: "Create fake output marker",
            description: "Create a file proving the runner applied a model-provided edit.",
            role: "coder",
            fileTargets: ["openmythos-fake-output.txt"],
            requiredTools: ["filesystem.write"],
            executionMode: "serial",
            acceptanceCriteria: [
              "The file exists",
              "The file contains OPENMYTHOS_FAKE_SUCCESS"
            ]
          }
        ],
        dependencies: {},
        successCriteria: [
          "openmythos-fake-output.txt exists",
          "openmythos-fake-output.txt contains OPENMYTHOS_FAKE_SUCCESS"
        ]
      };
    }

    if (request.system.includes("implement one planned task") || request.system.includes("review and correct one planned task")) {
      return {
        taskId: "task-1",
        status: "success",
        fileEdits: [
          {
            path: "openmythos-fake-output.txt",
            action: "create",
            content: "OPENMYTHOS_FAKE_SUCCESS\n",
            description: "Create deterministic success marker"
          }
        ],
        summary: "Created deterministic fake output marker.",
        errors: []
      };
    }

    if (request.system.includes("final QA gate")) {
      return {
        passed: true,
        score: 100,
        issues: [],
        suggestions: [],
        verifiedCriteria: [
          "openmythos-fake-output.txt exists",
          "openmythos-fake-output.txt contains OPENMYTHOS_FAKE_SUCCESS"
        ],
        failedCriteria: []
      };
    }

    return {};
  }
}
