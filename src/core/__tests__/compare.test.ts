import { describe, expect, it } from 'vitest';
import { applyCommand, initialAppState } from '../engine';
import { compareBatches } from '../compare';
import { AppState, Command } from '../types';

let n = 0;
const cid = () => `cmp-${++n}`;

const FROZEN_A = {
  productVersion: '大瓶 500ml / BOM v3.2',
  equipmentConfig: '导轨 G-500',
  inspectionStandard: 'SIP-500 v2.1',
  posts: [{ postId: 'P1', postName: '机长', operator: '王机长' }],
};
const FROZEN_B = {
  ...FROZEN_A,
  productVersion: '大瓶 500ml / BOM v3.3',
  posts: [{ postId: 'P1', postName: '机长', operator: '李机长' }],
};

function run(s: AppState, cmd: Command): AppState {
  const r = applyCommand(s, cmd);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('批次对比', () => {
  it('步骤状态差异与冻结基线差异都被标出', () => {
    let s = initialAppState();
    const rA = applyCommand(s, { id: cid(), type: 'CREATE_BATCH', name: '甲' });
    const aId = rA.meta!.batchId!;
    s = run(rA.state, { id: cid(), type: 'START_BATCH', batchId: aId, frozen: FROZEN_A });
    s = run(s, { id: cid(), type: 'START_STEP', batchId: aId, stepId: 'S1', operator: 'o' });
    s = run(s, { id: cid(), type: 'COMPLETE_STEP', batchId: aId, stepId: 'S1', operator: 'o' });

    const rB = applyCommand(s, { id: cid(), type: 'CREATE_BATCH', name: '乙' });
    const bId = rB.meta!.batchId!;
    s = run(rB.state, { id: cid(), type: 'START_BATCH', batchId: bId, frozen: FROZEN_B });

    const result = compareBatches(s.batches[aId], s.batches[bId]);
    expect(result.rows.length).toBe(10);

    const s1 = result.rows.find((r) => r.stepId === 'S1')!;
    expect(s1.changed).toBe(true);
    expect(s1.a?.exec).toBe('已完成');
    expect(s1.b?.exec).toBe('未执行');

    const s2 = result.rows.find((r) => r.stepId === 'S2')!;
    expect(s2.changed).toBe(false);

    const diffFields = result.frozenDiffs.map((d) => d.field);
    expect(diffFields).toContain('产品版本');
    expect(diffFields).toContain('岗位·机长');
    expect(diffFields).not.toContain('设备配置');
  });
});
