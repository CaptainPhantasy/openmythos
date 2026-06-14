import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SecurityFinding {
  type: "secret" | "dependency" | "pattern" | "destructive";
  severity: "critical" | "warning" | "info";
  file: string;
  line?: number;
  description: string;
  recommendation: string;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; recommendation: string }> = [
  {
    name: "AWS Access Key",
    regex: /AKIA[0-9A-Z]{16}/,
    recommendation: "Remove the AWS key and rotate it in the AWS console.",
  },
  {
    name: "GitHub Token",
    regex: /gh[pousr]_[A-Za-z0-9]{36}/,
    recommendation: "Remove the GitHub token and revoke it in GitHub settings.",
  },
  {
    name: "Generic API Key",
    regex: /(?:api[_-]?key|apikey|secret|token|password)\s*[:=]\s*["'][^"']{16,}["']/i,
    recommendation: "Move this credential to an environment variable or secrets manager.",
  },
  {
    name: "Private Key Block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    recommendation: "Remove the private key and rotate the associated certificate.",
  },
  {
    name: "Bearer Token",
    regex: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/,
    recommendation: "Remove the bearer token; it may grant unauthorized access.",
  },
];

const DESTRUCTIVE_COMMANDS: Array<{ name: string; regex: RegExp; recommendation: string }> = [
  {
    name: "Recursive Force Delete",
    regex: /\brm\s+-rf\b/,
    recommendation: "Avoid rm -rf; list files first and delete individually.",
  },
  {
    name: "Force Push",
    regex: /git\s+push\s+--force/,
    recommendation: "Use --force-with-lease instead of --force.",
  },
  {
    name: "Hard Reset",
    regex: /git\s+reset\s+--hard/,
    recommendation: "Stash changes before resetting; consider git revert instead.",
  },
  {
    name: "Drop Table",
    regex: /DROP\s+TABLE/i,
    recommendation: "Never run DROP TABLE in harness-managed code.",
  },
  {
    name: "World-Writable Permissions",
    regex: /chmod\s+777/,
    recommendation: "Use least-privilege permissions (e.g. chmod 644).",
  },
  {
    name: "Pipe to Shell",
    regex: /(?:curl|wget)\s+[^|]+\|\s*(?:sh|bash)/,
    recommendation: "Download and inspect scripts before executing.",
  },
  {
    name: "Force Clean",
    regex: /git\s+clean\s+-fd/,
    recommendation: "Review untracked files before force-cleaning.",
  },
];

export function scanForSecrets(content: string, filePath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const { name, regex, recommendation } of SECRET_PATTERNS) {
      if (regex.test(line)) {
        findings.push({
          type: "secret",
          severity: "critical",
          file: filePath,
          line: i + 1,
          description: `${name} detected on line ${i + 1}`,
          recommendation,
        });
      }
    }
  }

  return findings;
}

export async function auditDependencies(repoRoot: string): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  const pkgJsonPath = resolve(repoRoot, "package.json");
  const lockPath = resolve(repoRoot, "package-lock.json");
  const gitignorePath = resolve(repoRoot, ".gitignore");

  if (existsSync(pkgJsonPath) && !existsSync(lockPath)) {
    findings.push({
      type: "dependency",
      severity: "warning",
      file: "package.json",
      description: "package-lock.json is missing — dependency versions are not pinned.",
      recommendation: "Run npm install to generate the lockfile.",
    });
  }

  const envPattern = /^\.env$/m;
  if (existsSync(resolve(repoRoot, ".env")) && existsSync(gitignorePath)) {
    const gitignore = await readFile(gitignorePath, "utf8");
    if (!envPattern.test(gitignore)) {
      findings.push({
        type: "dependency",
        severity: "critical",
        file: ".env",
        description: ".env file exists but is not in .gitignore.",
        recommendation: "Add .env to .gitignore immediately.",
      });
    }
  }

  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name] of Object.entries(deps)) {
        if (name === "eval" || name === "vm2") {
          findings.push({
            type: "dependency",
            severity: "critical",
            file: "package.json",
            description: `Known-vulnerable package "${name}" detected in dependencies.`,
            recommendation: `Remove or replace "${name}" with a safer alternative.`,
          });
        }
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return findings;
}

export function assessEditRisk(content: string, filePath: string): SecurityFinding[] {
  return scanForSecrets(content, filePath);
}

export function assessCommandRisk(command: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { name, regex, recommendation } of DESTRUCTIVE_COMMANDS) {
    if (regex.test(command)) {
      findings.push({
        type: "destructive",
        severity: "critical",
        file: "<shell>",
        description: `${name} detected in command: ${command.slice(0, 100)}`,
        recommendation,
      });
    }
  }

  return findings;
}

export function summarizeRisk(findings: SecurityFinding[]): {
  level: "safe" | "caution" | "dangerous";
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  summary: string;
} {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  const level: "safe" | "caution" | "dangerous" =
    criticalCount > 0 ? "dangerous" : warningCount > 0 ? "caution" : "safe";

  const parts: string[] = [];
  if (criticalCount > 0) parts.push(`${criticalCount} critical`);
  if (warningCount > 0) parts.push(`${warningCount} warning(s)`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  return {
    level,
    criticalCount,
    warningCount,
    infoCount,
    summary:
      parts.length > 0
        ? `Risk assessment: ${level} (${parts.join(", ")})`
        : "Risk assessment: safe — no findings.",
  };
}
