import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getProviderPresets,
  detectProviderFromEnv,
  generateConfig,
  runInit,
} from "../core/init.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-init-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("init module", () => {
  it("returns 4 provider presets", () => {
    const presets = getProviderPresets();
    assert.ok(presets.length >= 4);
    const ids = presets.map((p) => p.id);
    assert.ok(ids.includes("zai"));
    assert.ok(ids.includes("openai"));
    assert.ok(ids.includes("anthropic"));
    assert.ok(ids.includes("gemini"));
  });

  it("each preset has 5 model roles", () => {
    for (const preset of getProviderPresets()) {
      assert.ok(preset.models.planner.length > 0);
      assert.ok(preset.models.coder.length > 0);
      assert.ok(preset.models.critic.length > 0);
      assert.ok(preset.models.verifier.length > 0);
      assert.ok(preset.models.compressor.length > 0);
    }
  });

  it("generates valid config with all required sections", () => {
    const preset = getProviderPresets()[0]!;
    const config = generateConfig(preset) as Record<string, unknown>;
    assert.ok(config.models, "config should have models");
    assert.ok(config.execution, "config should have execution");
    assert.ok(config.context, "config should have context");
    assert.ok(config.verification, "config should have verification");
    assert.ok(config.approval, "config should have approval");
    assert.ok(config.governance, "config should have governance");

    const models = config.models as Record<string, Record<string, unknown>>;
    assert.ok(models.planner, "should have planner model");
    assert.ok(models.coder, "should have coder model");
    assert.equal(models.planner!.adapter, preset.adapter);
    assert.equal(models.planner!.apiKeyEnv, preset.apiKeyEnv);
  });

  it("runInit creates config file in workdir", async () => {
    await withTempDir(async (dir) => {
      const result = await runInit(dir, "openai");
      assert.equal(result.alreadyExisted, false);
      assert.equal(result.provider, "OpenAI (GPT)");
      assert.ok(existsSync(resolve(dir, "openmythos.config.json")));

      const config = JSON.parse(await readFile(resolve(dir, "openmythos.config.json"), "utf8"));
      assert.ok(config.models.coder);
      assert.equal(config.models.coder.adapter, "openai");
    });
  });

  it("runInit returns alreadyExisted when config present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "openmythos.config.json"), '{"existing":true}', "utf8");
      const result = await runInit(dir, "zai");
      assert.equal(result.alreadyExisted, true);
    });
  });

  it("runInit throws for unknown provider", async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(() => runInit(dir, "nonexistent-provider"));
    });
  });

  it("runInit throws when no API key and no provider specified", async () => {
    await withTempDir(async (dir) => {
      const savedKeys: Record<string, string | undefined> = {};
      for (const preset of getProviderPresets()) {
        savedKeys[preset.apiKeyEnv] = process.env[preset.apiKeyEnv];
        delete process.env[preset.apiKeyEnv];
      }
      try {
        await assert.rejects(() => runInit(dir));
      } finally {
        for (const [k, v] of Object.entries(savedKeys)) {
          if (v !== undefined) process.env[k] = v;
        }
      }
    });
  });

  it("detectProviderFromEnv returns null when no keys set", () => {
    const savedKeys: Record<string, string | undefined> = {};
    for (const preset of getProviderPresets()) {
      savedKeys[preset.apiKeyEnv] = process.env[preset.apiKeyEnv];
      delete process.env[preset.apiKeyEnv];
    }
    try {
      const result = detectProviderFromEnv();
      assert.equal(result, null);
    } finally {
      for (const [k, v] of Object.entries(savedKeys)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });

  it("detectProviderFromEnv returns preset when key set", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key-value";
    try {
      const result = detectProviderFromEnv();
      assert.ok(result);
      assert.equal(result!.id, "openai");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});
