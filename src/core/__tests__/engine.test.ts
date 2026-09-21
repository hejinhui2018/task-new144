import { describe, expect, it } from 'vitest';
import { applyCommand, initialAppState } from '../engine';
import { releaseBlockers, stepBlockers, supersededEvidence, validEvidence } from '../selectors';
import { AppState, Command, Station, StepTemplate } from '../types';

let n = 0;
const cid = () => `cmd-${++n}`;

/**
 * 测试模板:
 *   A1(工位X,需证据)  A2(工位X)
 *        \           /
 *         A3(工位Y,需证据)
 *         /          \
 *   A4(工位Z,检查点)  A5(工位W)
 */
const TPL: StepTemplate[] = [
  { id: 'A1', name: '清场', stationId: 'X', deps: [], kind: 'normal', requiresEvidence: true, estimatedMinutes: 10, description: '' },
  { id: 'A2', name: '换轨', stationId: 'X', deps: [], kind: 'normal', requiresEvidence: false, estimatedMinutes: 10, description: '' },
  { id: 'A3', name: '调参', stationId: 'Y', deps: ['A1', 'A2'], kind: 'normal', requiresEvidence: true, estimatedMinutes: 10, description: '' },
  { id: 'A4', name: '首件', stationId: 'Z', deps: ['A3'], kind: 'checkpoint', requiresEvidence: false, estimatedMinutes: 10, description: '' },
  { id: 'A5', name: '复测', stationId: 'W', deps: ['A3'], kind: 'normal', requiresEvidence: false, estimatedMinutes: 10, description: '' },
];
const STNS: Station[] = [
  { id: 'X', name: 'X区' },
  { id: 'Y', name: 'Y区' },
  { id: 'Z', name: 'Z区' },
  { id: 'W', name: 'W区' },
];
const FROZEN = {
  productVersion: 'PV-500',
  equipmentConfig: 'EQ-1',
  inspectionStandard: 'SIP-1',
  posts: [{ postId: 'P1', postName: '机长', operator: '张三' }],
};

function run(s: AppState, cmd: Command): AppState {
  const r = applyCommand(s, cmd);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function newBatch(): { s: AppState; bid: string } {
  const r = applyCommand(initialAppState(), { id: cid(), type: 'CREATE_BATCH', name: '测试批', template: TPL, stations: STNS });
  const bid = r.meta!.batchId!;
  const s = run(r.state, { id: cid(), type: 'START_BATCH', batchId: bid, frozen: FROZEN });
  return { s, bid };
}

const start = (s: AppState, bid: string, stepId: string) =>
  run(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId, operator: '操作员' });
const complete = (s: AppState, bid: string, stepId: string, evidence?: { title: string; value: string }) =>
  run(s, { id: cid(), type: 'COMPLETE_STEP', batchId: bid, stepId, operator: '操作员', evidence });
const doStep = (s: AppState, bid: string, stepId: string, evidence?: { title: string; value: string }) =>
  complete(start(s, bid, stepId), bid, stepId, evidence);
const sign = (s: AppState, bid: string, stepId: string) =>
  run(s, { id: cid(), type: 'SIGN_OFF', batchId: bid, stepId, signer: '质检' });

describe('基线冻结', () => {
  it('启动即冻结基线,且不能重复冻结', () => {
    const { s, bid } = newBatch();
    const b = s.batches[bid];
    expect(b.status).toBe('running');
    expect(b.frozen?.productVersion).toBe('PV-500');
    expect(b.frozen?.frozenAt).toBeGreaterThan(0);
    const again = applyCommand(s, { id: cid(), type: 'START_BATCH', batchId: bid, frozen: FROZEN });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('重复冻结');
  });

  it('未启动批次不能执行步骤', () => {
    const r = applyCommand(initialAppState(), { id: cid(), type: 'CREATE_BATCH', name: 'x', template: TPL, stations: STNS });
    const bid = r.meta!.batchId!;
    const res = applyCommand(r.state, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A1', operator: 'o' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('未开始');
  });
});

describe('依赖与工位互锁', () => {
  it('前置未完成不能开始,阻塞原因可读出', () => {
    const { s, bid } = newBatch();
    const r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A3', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('前置');
    const reasons = stepBlockers(s.batches[bid], 'A3').join();
    expect(reasons).toContain('A1');
    expect(reasons).toContain('A2');
  });

  it('同工位互锁:进行中与已暂停都算占用,完成后释放', () => {
    let { s, bid } = newBatch();
    s = start(s, bid, 'A1');
    let r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A2', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('互锁');
    // 暂停仍占用工位
    s = run(s, { id: cid(), type: 'PAUSE_STEP', batchId: bid, stepId: 'A1', reason: '交接' });
    r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A2', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('互锁');
    // 完成后释放
    s = run(s, { id: cid(), type: 'RESUME_STEP', batchId: bid, stepId: 'A1' });
    s = complete(s, bid, 'A1', { title: '清场照片', value: 'ok' });
    s = start(s, bid, 'A2');
    expect(s.batches[bid].steps['A2'].exec).toBe('in_progress');
  });

  it('需要证据的步骤必须提交证据才能完成', () => {
    let { s, bid } = newBatch();
    s = start(s, bid, 'A1');
    const r = applyCommand(s, { id: cid(), type: 'COMPLETE_STEP', batchId: bid, stepId: 'A1', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('证据');
    s = complete(s, bid, 'A1', { title: '清场照片', value: '已清场' });
    const ev = validEvidence(s.batches[bid], 'A1');
    expect(ev.length).toBe(1);
    expect(ev[0].generation).toBe(0);
  });
});

describe('复测/回退的依赖传播与证据失效', () => {
  function chainDone() {
    let { s, bid } = newBatch();
    s = doStep(s, bid, 'A1', { title: '清场照', value: 'ok' });
    s = doStep(s, bid, 'A2');
    s = doStep(s, bid, 'A3', { title: '参数表', value: 'v1' });
    s = doStep(s, bid, 'A4');
    s = doStep(s, bid, 'A5');
    s = sign(s, bid, 'A5');
    return { s, bid };
  }

  it('复测使传递下游失效,旧证据保留为失效档案,签收作废', () => {
    let { s, bid } = chainDone();
    s = run(s, { id: cid(), type: 'RETEST_STEP', batchId: bid, stepId: 'A3', reason: '参数疑似录错', operator: '机长' });
    const b = s.batches[bid];
    // 目标:回到进行中,代次 +1
    expect(b.steps['A3'].exec).toBe('in_progress');
    expect(b.steps['A3'].generation).toBe(1);
    // 传递下游失效
    expect(b.steps['A4'].exec).toBe('idle');
    expect(b.steps['A4'].generation).toBe(1);
    expect(b.steps['A5'].exec).toBe('idle');
    expect(b.steps['A5'].invalidations).toBe(1);
    expect(b.steps['A5'].signedBy).toBeNull();
    // 上游与旁支不受影响
    expect(b.steps['A1'].exec).toBe('done');
    expect(b.steps['A2'].exec).toBe('done');
    // 旧证据保留但失效
    const old = supersededEvidence(b, 'A3');
    expect(old.length).toBe(1);
    expect(old[0].title).toBe('参数表');
    expect(validEvidence(b, 'A3').length).toBe(0);
    // 失效后不再满足下游前置
    expect(stepBlockers(b, 'A4').join()).toContain('A3');
  });

  it('回退完成的步骤并失效其下游,独立旁支不受影响', () => {
    let { s, bid } = chainDone();
    s = run(s, { id: cid(), type: 'ROLLBACK_STEP', batchId: bid, stepId: 'A1', reason: '清场复核不通过', operator: '机长' });
    const b = s.batches[bid];
    expect(b.steps['A1'].exec).toBe('idle');
    expect(b.steps['A1'].generation).toBe(1);
    expect(b.steps['A3'].exec).toBe('idle');
    expect(b.steps['A4'].exec).toBe('idle');
    expect(b.steps['A5'].exec).toBe('idle');
    expect(b.steps['A2'].exec).toBe('done'); // A2 不是 A1 的下游
  });

  it('过期代次的迟到回执归档为失效,不覆盖当前结论', () => {
    let { s, bid } = chainDone();
    s = run(s, { id: cid(), type: 'RETEST_STEP', batchId: bid, stepId: 'A3', reason: '复核', operator: '机长' });
    // A3 现为第 2 代进行中;补交第 1 代的检测结果(模拟上一次换线的迟到结果)
    s = run(s, {
      id: cid(), type: 'SUBMIT_EVIDENCE', batchId: bid, stepId: 'A3',
      title: '迟到的检测值', value: '99.1', submittedBy: '实验室', forGeneration: 0,
    });
    const b = s.batches[bid];
    const late = b.evidence.find((e) => e.title === '迟到的检测值')!;
    expect(late.status).toBe('superseded');
    expect(b.steps['A3'].exec).toBe('in_progress');
    expect(validEvidence(b, 'A3').length).toBe(0);
  });
});

describe('跳过/签收/放行/终止', () => {
  it('跳过满足下游依赖;放行需全部完成并签收', () => {
    let { s, bid } = newBatch();
    s = doStep(s, bid, 'A1', { title: 'e', value: 'v' });
    s = run(s, { id: cid(), type: 'SKIP_STEP', batchId: bid, stepId: 'A2', reason: '沿用上次导轨', operator: '机长' });
    s = doStep(s, bid, 'A3', { title: 'e3', value: 'v3' }); // A2 已跳过,依赖满足
    s = doStep(s, bid, 'A4');
    s = doStep(s, bid, 'A5');
    // 未签收不能放行
    let r = applyCommand(s, { id: cid(), type: 'CLOSE_BATCH', batchId: bid, decision: 'released', reason: '', operator: 'QA' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不具备放行条件');
    expect(releaseBlockers(s.batches[bid]).join()).toContain('未签收');
    for (const id of ['A1', 'A3', 'A4', 'A5']) s = sign(s, bid, id);
    expect(releaseBlockers(s.batches[bid])).toEqual([]);
    s = run(s, { id: cid(), type: 'CLOSE_BATCH', batchId: bid, decision: 'released', reason: '', operator: 'QA' });
    const b = s.batches[bid];
    expect(b.status).toBe('closed');
    expect(b.release?.decision).toBe('released');
    expect(b.release?.basis.skippedSteps).toEqual(['A2']);
    expect(b.release?.basis.doneSteps).toEqual(['A1', 'A3', 'A4', 'A5']);
    expect(b.release?.basis.signoffs.length).toBe(4);
  });

  it('提前终止:进行中步骤被冻结,关闭后禁止操作', () => {
    let { s, bid } = newBatch();
    s = start(s, bid, 'A1');
    s = run(s, { id: cid(), type: 'CLOSE_BATCH', batchId: bid, decision: 'terminated', reason: '计划取消', operator: '机长' });
    const b = s.batches[bid];
    expect(b.status).toBe('closed');
    expect(b.closeDecision).toBe('terminated');
    expect(b.steps['A1'].exec).toBe('paused');
    const r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A2', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('关闭');
  });
});

describe('中断与续作', () => {
  it('中断自动暂停进行中步骤,续作后可继续', () => {
    let { s, bid } = newBatch();
    s = start(s, bid, 'A1');
    s = run(s, { id: cid(), type: 'INTERRUPT_BATCH', batchId: bid, reason: '夜班交接' });
    expect(s.batches[bid].status).toBe('interrupted');
    expect(s.batches[bid].steps['A1'].exec).toBe('paused');
    expect(s.batches[bid].steps['A1'].pauseReason).toContain('夜班交接');
    const r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A2', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('中断');
    s = run(s, { id: cid(), type: 'RESUME_BATCH', batchId: bid });
    expect(s.batches[bid].status).toBe('running');
    s = run(s, { id: cid(), type: 'RESUME_STEP', batchId: bid, stepId: 'A1' });
    expect(s.batches[bid].steps['A1'].exec).toBe('in_progress');
  });
});

describe('迟到回执与待核对区', () => {
  it('关闭后的回执只进待核对区,核对后归档且不改结论', () => {
    let { s, bid } = newBatch();
    s = doStep(s, bid, 'A1', { title: 'e', value: 'v' });
    s = run(s, { id: cid(), type: 'CLOSE_BATCH', batchId: bid, decision: 'terminated', reason: '演练', operator: 'o' });
    const closedAt = s.batches[bid].closedAt;
    s = run(s, { id: cid(), type: 'SUBMIT_EVIDENCE', batchId: bid, stepId: 'A1', title: '迟到报告', value: 'x', submittedBy: '实验室' });
    expect(s.lateInbox.length).toBe(1);
    expect(s.lateInbox[0].status).toBe('late_pending');
    expect(s.batches[bid].closedAt).toBe(closedAt);
    expect(s.batches[bid].evidence.filter((e) => e.title === '迟到报告').length).toBe(0);
    const evId = s.lateInbox[0].id;
    s = run(s, { id: cid(), type: 'REVIEW_LATE_EVIDENCE', evidenceId: evId, accept: true, note: '属实', reviewer: 'QA' });
    expect(s.lateInbox.length).toBe(0);
    const archived = s.batches[bid].evidence.find((e) => e.id === evId)!;
    expect(archived.status).toBe('late_accepted');
    expect(archived.reviewNote).toBe('属实');
    expect(s.batches[bid].steps['A1'].exec).toBe('done'); // 步骤状态未被回写
    expect(s.batches[bid].release?.decision).toBe('terminated'); // 结论不变
  });

  it('重复核对同一回执被拒绝', () => {
    let { s, bid } = newBatch();
    s = run(s, { id: cid(), type: 'CLOSE_BATCH', batchId: bid, decision: 'terminated', reason: 'r', operator: 'o' });
    s = run(s, { id: cid(), type: 'SUBMIT_EVIDENCE', batchId: bid, stepId: 'A1', title: 't', value: 'v', submittedBy: 'lab' });
    const evId = s.lateInbox[0].id;
    s = run(s, { id: cid(), type: 'REVIEW_LATE_EVIDENCE', evidenceId: evId, accept: false, note: '', reviewer: 'QA' });
    const r = applyCommand(s, { id: cid(), type: 'REVIEW_LATE_EVIDENCE', evidenceId: evId, accept: true, note: '', reviewer: 'QA' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('已处理');
  });
});

describe('重复操作', () => {
  it('相同指令 id 幂等,不产生第二次副作用', () => {
    const { s, bid } = newBatch();
    const cmd: Command = { id: 'dup-1', type: 'START_STEP', batchId: bid, stepId: 'A1', operator: 'o' };
    const r1 = applyCommand(s, cmd);
    expect(r1.ok).toBe(true);
    const r2 = applyCommand(r1.state, cmd);
    expect(r2.ok).toBe(true);
    expect(r2.duplicate).toBe(true);
    expect(r2.state).toBe(r1.state); // 状态原样返回
    expect(r2.state.batches[bid].steps['A1'].exec).toBe('in_progress');
    expect(r2.state.batches[bid].events.filter((e) => e.message.includes('开始 A1')).length).toBe(1);
  });

  it('语义重复被拒绝:重复开始/重复签收/重复完成', () => {
    let { s, bid } = newBatch();
    s = start(s, bid, 'A1');
    let r = applyCommand(s, { id: cid(), type: 'START_STEP', batchId: bid, stepId: 'A1', operator: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('重复开始');
    s = complete(s, bid, 'A1', { title: 'e', value: 'v' });
    r = applyCommand(s, { id: cid(), type: 'COMPLETE_STEP', batchId: bid, stepId: 'A1', operator: 'o', evidence: { title: 'x', value: 'y' } });
    expect(r.ok).toBe(false);
    s = sign(s, bid, 'A1');
    r = applyCommand(s, { id: cid(), type: 'SIGN_OFF', batchId: bid, stepId: 'A1', signer: 'QA2' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('重复签收');
  });
});

describe('检查点派生与继承', () => {
  function toCheckpoint() {
    let { s, bid } = newBatch();
    s = doStep(s, bid, 'A1', { title: '清场照', value: 'ok' });
    s = run(s, { id: cid(), type: 'SKIP_STEP', batchId: bid, stepId: 'A2', reason: '沿用', operator: '机长' });
    s = doStep(s, bid, 'A3', { title: '参数表', value: 'v1' });
    s = doStep(s, bid, 'A4');
    s = sign(s, bid, 'A4');
    return { s, bid };
  }

  it('派生可继承有效结果(含跳过与签收),证据标注来源,新批次独立演进', () => {
    let { s, bid } = toCheckpoint();
    const r = applyCommand(s, {
      id: cid(), type: 'DERIVE_BATCH', sourceBatchId: bid, checkpointStepId: 'A4',
      inheritStepIds: ['A1', 'A2', 'A3', 'A4'], name: '续跑批',
    });
    expect(r.ok).toBe(true);
    const nid = r.meta!.batchId!;
    s = r.state;
    const nb = s.batches[nid];
    expect(nb.derivedFrom).toEqual({ batchId: bid, checkpointStepId: 'A4' });
    expect(nb.steps['A1'].exec).toBe('done');
    expect(nb.steps['A1'].inheritedFrom).toBe(bid);
    expect(nb.steps['A2'].exec).toBe('skipped');
    expect(nb.steps['A4'].signedBy).toBe('质检');
    expect(nb.steps['A5'].exec).toBe('idle'); // 检查点下游不继承
    const inherited = nb.evidence.filter((e) => e.inheritedFromBatch === bid);
    expect(inherited.length).toBe(2); // 清场照 + 参数表
    expect(inherited.every((e) => e.status === 'valid')).toBe(true);
    // 源批次回退不影响派生批次
    s = run(s, { id: cid(), type: 'ROLLBACK_STEP', batchId: bid, stepId: 'A3', reason: '复核', operator: 'o' });
    expect(s.batches[nid].steps['A3'].exec).toBe('done');
    expect(s.batches[bid].steps['A3'].exec).toBe('idle');
  });

  it('继承集必须闭合前置依赖,且只能继承检查点上游的有效结果', () => {
    const { s, bid } = toCheckpoint();
    // 缺前置 A1/A2
    let r = applyCommand(s, { id: cid(), type: 'DERIVE_BATCH', sourceBatchId: bid, checkpointStepId: 'A4', inheritStepIds: ['A3', 'A4'], name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('前置');
    // A5 不在检查点上游范围内
    r = applyCommand(s, { id: cid(), type: 'DERIVE_BATCH', sourceBatchId: bid, checkpointStepId: 'A4', inheritStepIds: ['A1', 'A2', 'A3', 'A4', 'A5'], name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('可继承范围');
    // 非检查点不能作为派生来源
    r = applyCommand(s, { id: cid(), type: 'DERIVE_BATCH', sourceBatchId: bid, checkpointStepId: 'A3', inheritStepIds: [], name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('检查点');
  });

  it('检查点未完成不能派生', () => {
    const { s, bid } = newBatch();
    const r = applyCommand(s, { id: cid(), type: 'DERIVE_BATCH', sourceBatchId: bid, checkpointStepId: 'A4', inheritStepIds: [], name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('尚未完成');
  });
});
