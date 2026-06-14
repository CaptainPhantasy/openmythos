import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createReviewBundle } from "../core/review.js";
import type { OpenMythosConfig } from "../config/schema.js";

const approval: OpenMythosConfig["approval"] = {
  mode: "enforce",
  protectedPaths: ["package.json", ".env*"],
  highRiskExtensions: [".pem", ".key"],
  dependencyManifestPaths: ["package.json"]
};

test("createReviewBundle writes patch and marks protected or destructive edits as high risk", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-review-"));
  const runDir = resolve(workdir, "runs", "run-1");
  await writeFile(resolve(workdir, "package.json"), "{\"name\":\"demo\"}\n");

  const review = await createReviewBundle(workdir, runDir, "task-1", [
    {
      path: "package.json",
      action: "modify",
      content: "{\"name\":\"demo\",\"private\":true}\n",
      description: "modify package manifest"
    },
    {
      path: "delete-me.txt",
      action: "delete",
      content: "",
      description: "delete file"
    }
  ], approval);

  const patch = await readFile(review.patchPath, "utf8");
  const metadata = JSON.parse(await readFile(review.reviewPath, "utf8")) as {
    highestRisk: string;
    blocking: boolean;
    reviews: Array<{ path: string; risk: { level: string; reasons: string[] } }>;
  };

  assert.equal(review.blocking, true);
  assert.equal(review.highestRisk, "high");
  assert.match(patch, /diff --git a\/package\.json b\/package\.json/);
  assert.equal(metadata.highestRisk, "high");
  assert.equal(metadata.blocking, true);
  assert.deepEqual(
    metadata.reviews.find((entry) => entry.path === "package.json")?.risk.reasons,
    ["dependency manifest touched", "protected path matched"]
  );
  assert.deepEqual(
    metadata.reviews.find((entry) => entry.path === "delete-me.txt")?.risk.reasons,
    ["delete action"]
  );
});
