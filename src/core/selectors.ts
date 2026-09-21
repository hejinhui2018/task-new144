import { Batch, Evidence, ExecState, StepState, StepTemplate } from './types';

export const EXEC_LABEL: Record<ExecState, string> = {
  idle: '未执行',
  in_progress: '进行中',
  paused: '已暂停',
  done: '已完成',
  skipped: '已跳过',
};

export function templateOf(batch: Batch, stepId: string): StepTemplate | null {
  return batch.template.find((t) => t.id === stepId) ?? null;
}

/** 前置是否满足:完成或经审批跳过均视为满足 */
export function depSatisfied(s: StepState): boolean {
  return s.exec === 'done' || s.exec === 'skipped';
}

/** 工位互锁:同一工位上处于进行中/已暂停的步骤即占用者 */
export function stationOccupant(batch: Batch, stationId: string, excludeStepId?: string): string | null {
  for (const t of batch.template) {
    if (t.stationId !== stationId || t.id === excludeStepId) continue;
    const s = batch.steps[t.id];
    if (s.exec === 'in_progress' || s.exec === 'paused') return t.id;
  }
  return null;
}

export function stationName(batch: Batch, stationId: string): string {
  return batch.stations.find((s) => s.id === stationId)?.name ?? stationId;
}

/** 步骤当前不能开始的原因列表(空数组 = 可开始) */
export function stepBlockers(batch: Batch, stepId: string): string[] {
  const t = templateOf(batch, stepId);
  if (!t) return ['步骤不存在'];
  const reasons: string[] = [];
  if (batch.status === 'draft') reasons.push('批次未开始');
  else if (batch.status === 'interrupted') reasons.push('批次已中断,需先续作');
  else if (batch.status === 'closed') reasons.push('批次已关闭');
  for (const d of t.deps) {
    if (!depSatisfied(batch.steps[d])) reasons.push(`等待前置步骤 ${d}`);
  }
  const occ = stationOccupant(batch, t.stationId, stepId);
  if (occ) reasons.push(`工位互锁:${stationName(batch, t.stationId)}被 ${occ} 占用`);
  return reasons;
}

export function validEvidence(batch: Batch, stepId: string): Evidence[] {
  return batch.evidence.filter((e) => e.stepId === stepId && e.status === 'valid');
}

export function supersededEvidence(batch: Batch, stepId: string): Evidence[] {
  return batch.evidence.filter((e) => e.stepId === stepId && e.status === 'superseded');
}

/** 放行的全部阻塞项;为空表示具备放行条件 */
export function releaseBlockers(batch: Batch): string[] {
  if (batch.status !== 'running') {
    if (batch.status === 'interrupted') return ['批次中断中,请先续作'];
    if (batch.status === 'closed') return ['批次已关闭'];
    return ['批次未开始'];
  }
  const out: string[] = [];
  for (const t of batch.template) {
    const s = batch.steps[t.id];
    if (!depSatisfied(s)) {
      out.push(`${t.id} ${t.name} 未完成(${EXEC_LABEL[s.exec]})`);
      continue;
    }
    if (s.exec === 'done' && !s.signedBy) out.push(`${t.id} ${t.name} 未签收`);
  }
  return out;
}

export function batchProgress(batch: Batch): { done: number; total: number } {
  const total = batch.template.length;
  const done = batch.template.filter((t) => depSatisfied(batch.steps[t.id])).length;
  return { done, total };
}
