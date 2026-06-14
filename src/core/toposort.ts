import type { PlanTask } from "./types.js";

export function sortTasks(tasks: PlanTask[], dependencies: Record<string, string[]>): PlanTask[] {
  return buildExecutionBatches(tasks, dependencies).flat();
}

export function buildExecutionBatches(tasks: PlanTask[], dependencies: Record<string, string[]>): PlanTask[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const task of tasks) {
    indegree.set(task.id, 0);
    outgoing.set(task.id, []);
  }

  for (const [taskId, deps] of Object.entries(dependencies)) {
    if (!byId.has(taskId)) {
      throw new Error(`Unknown task dependency owner: ${taskId}`);
    }
    for (const dep of deps) {
      if (!byId.has(dep)) {
        throw new Error(`Unknown task dependency: ${dep}`);
      }
      indegree.set(taskId, (indegree.get(taskId) ?? 0) + 1);
      outgoing.get(dep)?.push(taskId);
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort();

  const ordered: string[] = [];
  const waves: PlanTask[][] = [];

  while (ready.length > 0) {
    const currentIds = [...ready];
    ready.length = 0;
    const currentTasks = currentIds.map((id) => byId.get(id)).filter((task): task is PlanTask => Boolean(task));
    waves.push(...partitionWave(currentTasks));
    ordered.push(...currentIds);

    for (const id of currentIds) {
      for (const next of outgoing.get(id) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if ((indegree.get(next) ?? 0) === 0) {
          ready.push(next);
        }
      }
    }
    ready.sort();
  }

  if (ordered.length !== tasks.length) {
    throw new Error("Circular task dependency detected");
  }

  return waves;
}

function partitionWave(tasks: PlanTask[]): PlanTask[][] {
  const batches: PlanTask[][] = [];
  const parallelTasks = tasks
    .filter((task) => task.executionMode === "parallel")
    .sort((a, b) => a.id.localeCompare(b.id));
  const serialTasks = tasks
    .filter((task) => task.executionMode !== "parallel")
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const task of parallelTasks) {
    const conflict = task.fileTargets.length === 0 ? false : undefined;
    let placed = false;
    for (const batch of batches) {
      if (hasTargetConflict(batch, task)) {
        continue;
      }
      batch.push(task);
      placed = true;
      break;
    }
    if (!placed || conflict === false && batches.length === 0) {
      batches.push([task]);
    }
  }

  for (const task of serialTasks) {
    batches.push([task]);
  }

  return batches;
}

function hasTargetConflict(batch: PlanTask[], candidate: PlanTask): boolean {
  const candidateTargets = normalizedTargets(candidate);
  if (candidateTargets.size === 0) {
    return false;
  }
  for (const task of batch) {
    const batchTargets = normalizedTargets(task);
    for (const target of candidateTargets) {
      if (batchTargets.has(target)) {
        return true;
      }
    }
  }
  return false;
}

function normalizedTargets(task: PlanTask): Set<string> {
  return new Set(task.fileTargets.map((target) => target.toLowerCase()));
}
