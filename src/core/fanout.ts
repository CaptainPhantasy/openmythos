// Multi-agent fan-out: run independent sub-tasks in parallel, respecting
// dependency ordering, with bounded concurrency. This is what lets the harness
// spawn parallel workers for disjoint sub-problems instead of serializing them.

export interface FanoutTask<T> {
  id: string;
  dependsOn?: string[];
  run: () => Promise<T>;
}

export interface FanoutResult<T> {
  id: string;
  status: "completed" | "failed";
  result?: T;
  error?: string;
  durationMs: number;
}

/**
 * Build dependency-ordered batches (topological levels). Each batch contains
 * tasks whose dependencies all appear in earlier batches, so every task in a
 * batch can run concurrently. Throws on cycles.
 */
export function buildFanoutBatches<T>(tasks: FanoutTask<T>[]): FanoutTask<T>[][] {
  const byId = new Map<string, FanoutTask<T>>();
  for (const task of tasks) byId.set(task.id, task);

  const resolved = new Set<string>();
  const batches: FanoutTask<T>[][] = [];
  let remaining = [...tasks];

  while (remaining.length > 0) {
    const ready = remaining.filter((task) =>
      (task.dependsOn ?? []).every((dep) => resolved.has(dep) || !byId.has(dep))
    );
    if (ready.length === 0) {
      throw new Error(
        `Dependency cycle or missing dependency among: ${remaining.map((t) => t.id).join(", ")}`
      );
    }
    batches.push(ready);
    for (const task of ready) resolved.add(task.id);
    const readyIds = new Set(ready.map((t) => t.id));
    remaining = remaining.filter((task) => !readyIds.has(task.id));
  }

  return batches;
}

/**
 * Map items through an async mapper with bounded concurrency, preserving input
 * order. Propagates the first rejection (same failure semantics as Promise.all).
 * This is the primitive the harness uses to cap parallel worker calls so it
 * never exceeds a model's concurrency limit.
 */
export async function mapWithConcurrency<I, O>(
  items: I[],
  mapper: (item: I, index: number) => Promise<O>,
  maxConcurrency: number
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!, index);
    }
  }

  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Run a list of thunks through a bounded concurrency pool, preserving input order.
 */
async function runPool<T>(
  items: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  return mapWithConcurrency(items, (thunk) => thunk(), maxConcurrency);
}

/**
 * Fan out tasks in dependency-ordered batches. Within each batch, tasks run
 * concurrently up to `maxConcurrency`. A failing task does not abort its peers;
 * its failure is captured in the result. Downstream batches still run (their
 * dependencies may have other satisfied inputs) — callers inspect results to
 * decide whether to proceed.
 */
export async function fanOut<T>(
  tasks: FanoutTask<T>[],
  maxConcurrency = 4
): Promise<FanoutResult<T>[]> {
  const batches = buildFanoutBatches(tasks);
  const allResults: FanoutResult<T>[] = [];

  for (const batch of batches) {
    const batchResults = await runPool(
      batch.map((task) => async (): Promise<FanoutResult<T>> => {
        const started = Date.now();
        try {
          const result = await task.run();
          return { id: task.id, status: "completed", result, durationMs: Date.now() - started };
        } catch (error) {
          return {
            id: task.id,
            status: "failed",
            error: (error as Error).message,
            durationMs: Date.now() - started,
          };
        }
      }),
      maxConcurrency
    );
    allResults.push(...batchResults);
  }

  return allResults;
}
