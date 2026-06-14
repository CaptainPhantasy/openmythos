import type { PlanTask } from "./types.js";

export function sortTasks(tasks: PlanTask[], dependencies: Record<string, string[]>): PlanTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const sorted: PlanTask[] = [];

  function visit(id: string): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Circular task dependency involving ${id}`);
    }
    const task = byId.get(id);
    if (!task) {
      throw new Error(`Unknown task dependency: ${id}`);
    }

    visiting.add(id);
    for (const dep of dependencies[id] ?? []) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task.id);
  }

  return sorted;
}
