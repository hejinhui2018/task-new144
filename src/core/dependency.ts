import { StepTemplate } from './types';

/** 某步骤的全部传递上游(不含自身) */
export function transitiveDeps(template: StepTemplate[], stepId: string): string[] {
  const byId = new Map(template.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string) => {
    const t = byId.get(id);
    if (!t) return;
    for (const d of t.deps) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(d);
      visit(d);
    }
  };
  visit(stepId);
  return out;
}

/** 某步骤的全部传递下游(不含自身),复测/回退时的失效传播范围 */
export function transitiveDependents(template: StepTemplate[], stepId: string): string[] {
  const children = new Map<string, string[]>();
  for (const t of template) {
    for (const d of t.deps) {
      const arr = children.get(d) ?? [];
      arr.push(t.id);
      children.set(d, arr);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string) => {
    for (const c of children.get(id) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      visit(c);
    }
  };
  visit(stepId);
  return out;
}

/** 按估计工时求 DAG 最长链(关键路径) */
export function criticalPath(template: StepTemplate[]): { path: string[]; minutes: number } {
  const byId = new Map(template.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const best = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const t = byId.get(id);
    if (!t) return 0;
    const base = t.deps.length ? Math.max(...t.deps.map(best)) : 0;
    const total = base + t.estimatedMinutes;
    memo.set(id, total);
    return total;
  };
  let end: string | null = null;
  let minutes = 0;
  for (const t of template) {
    const v = best(t.id);
    if (v > minutes) {
      minutes = v;
      end = t.id;
    }
  }
  const path: string[] = [];
  let cur = end;
  while (cur) {
    path.unshift(cur);
    const t = byId.get(cur)!;
    let next: string | null = null;
    let nextV = -1;
    for (const d of t.deps) {
      const v = memo.get(d) ?? 0;
      if (v > nextV) {
        nextV = v;
        next = d;
      }
    }
    cur = next;
  }
  return { path, minutes };
}
