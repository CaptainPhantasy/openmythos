import type { AdapterRequest, AdapterResponse } from "../core/types.js";

export interface ModelAdapter {
  call(request: AdapterRequest): Promise<AdapterResponse>;
}

export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 1000)}`);
      }

      const retryAfter = response.headers.get("retry-after");
      const delay = retryAfter ? Number(retryAfter) * 1000 : 500 * 2 ** attempt;
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await sleep(500 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
