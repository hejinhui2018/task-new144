import { Batch } from './types';
import { EXEC_LABEL } from './selectors';

export interface StepCompareCell {
  exec: string;
  generation: number;
  invalidations: number;
  validEvidence: number;
  supersededEvidence: number;
  signed: boolean;
}

export interface StepCompareRow {
  stepId: string;
  name: string;
  a: StepCompareCell | null;
  b: StepCompareCell | null;
  changed: boolean;
}

export interface FrozenDiff {
  field: string;
  a: string;
  b: string;
}

export interface CompareResult {
  rows: StepCompareRow[];
  frozenDiffs: FrozenDiff[];
}

function cell(batch: Batch, stepId: string): StepCompareCell | null {
  const s = batch.steps[stepId];
  if (!s) return null;
  return {
    exec: EXEC_LABEL[s.exec],
    generation: s.generation,
    invalidations: s.invalidations,
    validEvidence: batch.evidence.filter((e) => e.stepId === stepId && e.status === 'valid').length,
    supersededEvidence: batch.evidence.filter((e) => e.stepId === stepId && e.status === 'superseded').length,
    signed: !!s.signedBy,
  };
}

export function compareBatches(a: Batch, b: Batch): CompareResult {
  const ids: string[] = [];
  const names = new Map<string, string>();
  for (const t of [...a.template, ...b.template]) {
    if (!names.has(t.id)) {
      names.set(t.id, t.name);
      ids.push(t.id);
    }
  }
  const rows: StepCompareRow[] = ids.map((id) => {
    const ca = cell(a, id);
    const cb = cell(b, id);
    return {
      stepId: id,
      name: names.get(id) ?? id,
      a: ca,
      b: cb,
      changed: JSON.stringify(ca) !== JSON.stringify(cb),
    };
  });

  const frozenDiffs: FrozenDiff[] = [];
  const fa = a.frozen;
  const fb = b.frozen;
  const fields: { key: 'productVersion' | 'equipmentConfig' | 'inspectionStandard'; label: string }[] = [
    { key: 'productVersion', label: '产品版本' },
    { key: 'equipmentConfig', label: '设备配置' },
    { key: 'inspectionStandard', label: '检查标准' },
  ];
  for (const f of fields) {
    const va = fa?.[f.key] ?? '—';
    const vb = fb?.[f.key] ?? '—';
    if (va !== vb) frozenDiffs.push({ field: f.label, a: va, b: vb });
  }
  const postsA = new Map((fa?.posts ?? []).map((p) => [p.postName, p.operator]));
  const postsB = new Map((fb?.posts ?? []).map((p) => [p.postName, p.operator]));
  for (const name of new Set([...postsA.keys(), ...postsB.keys()])) {
    const va = postsA.get(name) ?? '—';
    const vb = postsB.get(name) ?? '—';
    if (va !== vb) frozenDiffs.push({ field: `岗位·${name}`, a: va, b: vb });
  }
  return { rows, frozenDiffs };
}
