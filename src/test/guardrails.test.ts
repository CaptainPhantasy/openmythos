import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanForSecrets, assessCommandRisk, summarizeRisk } from "../core/guardrails.js";

// Construct test patterns programmatically to avoid triggering secrets scanners in source
const awsKey = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
const ghToken = ["ghp_", "a".repeat(36)].join("");
const genericSecret = ['apikey = "', "x".repeat(20), '"'].join("");
const pemHeader = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");

describe("guardrails", () => {
  it("detects AWS access keys", () => {
    const findings = scanForSecrets(`key = ${awsKey}`, "test.txt");
    const f = findings[0];
    assert.ok(f);
    assert.equal(f!.type, "secret");
    assert.equal(f!.severity, "critical");
  });

  it("detects GitHub tokens", () => {
    const findings = scanForSecrets(`token: ${ghToken}`, "config.yml");
    assert.ok(findings.length > 0);
    assert.equal(findings[0]!.type, "secret");
  });

  it("detects private key blocks", () => {
    const content = `${pemHeader}\nMIIabc\n-----END RSA PRIVATE KEY-----`;
    const findings = scanForSecrets(content, "id_rsa");
    assert.ok(findings.length > 0);
  });

  it("detects generic API key pattern", () => {
    const findings = scanForSecrets(genericSecret, "env.js");
    assert.ok(findings.length > 0);
  });

  it("returns empty for clean content", () => {
    const findings = scanForSecrets("const x = 42;", "clean.ts");
    assert.equal(findings.length, 0);
  });

  it("detects destructive commands", () => {
    const parts = ["rm", "-rf", "/tmp/test"];
    const findings = assessCommandRisk(parts.join(" "));
    assert.ok(findings.length > 0);
    assert.equal(findings[0]!.type, "destructive");
  });

  it("detects force push", () => {
    const cmd = ["git", "push", "--force", "origin", "main"].join(" ");
    const findings = assessCommandRisk(cmd);
    assert.ok(findings.length > 0);
  });

  it("returns empty for safe commands", () => {
    const findings = assessCommandRisk("npm run build");
    assert.equal(findings.length, 0);
  });

  it("summarizeRisk returns dangerous for critical findings", () => {
    const summary = summarizeRisk([
      { type: "secret", severity: "critical", file: "test.txt", description: "key", recommendation: "remove" }
    ]);
    assert.equal(summary.level, "dangerous");
    assert.equal(summary.criticalCount, 1);
  });

  it("summarizeRisk returns safe for no findings", () => {
    const summary = summarizeRisk([]);
    assert.equal(summary.level, "safe");
    assert.equal(summary.criticalCount, 0);
  });

  it("summarizeRisk returns caution for warnings only", () => {
    const summary = summarizeRisk([
      { type: "dependency", severity: "warning", file: "package.json", description: "no lockfile", recommendation: "run npm install" }
    ]);
    assert.equal(summary.level, "caution");
  });
});
