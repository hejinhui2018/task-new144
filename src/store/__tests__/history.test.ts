import { describe, expect, it } from 'vitest';
import { initialAppState } from '../../core/engine';
import { apply, initHistory, redo, undo } from '../history';
import { Command } from '../../core/types';

const FROZEN = {
  productVersion: 'PV',
  equipmentConfig: 'EQ',
  inspectionStandard: 'STD',
  posts: [{ postId: 'P1', postName: '机长', operator: '张三' }],
};

describe('撤销/重做历史', () => {
  it('undo 回退状态,redo 重放,新指令清空 future', () => {
    let h = initHistory(initialAppState());
    const r1 = apply(h, { id: 'c1', type: 'CREATE_BATCH', name: 'X' });
    h = r1.history;
    const bid = r1.outcome.meta!.batchId!;
    const r2 = apply(h, { id: 'c2', type: 'START_BATCH', batchId: bid, frozen: FROZEN });
    h = r2.history;
    expect(h.present.batches[bid].status).toBe('running');

    h = undo(h);
    expect(h.present.batches[bid].status).toBe('draft');
    h = redo(h);
    expect(h.present.batches[bid].status).toBe('running');

    h = undo(h);
    const r3 = apply(h, { id: 'c3', type: 'CREATE_BATCH', name: 'Y' });
    h = r3.history;
    expect(h.future.length).toBe(0);
    expect(Object.keys(h.present.batches).length).toBe(2);
  });

  it('失败指令与重复指令不产生历史', () => {
    let h = initHistory(initialAppState());
    const r1 = apply(h, { id: 'c1', type: 'CREATE_BATCH', name: 'X' });
    h = r1.history;
    const depth = h.past.length;

    const bad: Command = { id: 'c2', type: 'START_BATCH', batchId: 'NOPE', frozen: FROZEN };
    const rBad = apply(h, bad);
    expect(rBad.outcome.ok).toBe(false);
    expect(rBad.history.past.length).toBe(depth);
    expect(rBad.history.present).toBe(h.present);

    const rDup = apply(h, { id: 'c1', type: 'CREATE_BATCH', name: 'X' });
    expect(rDup.outcome.duplicate).toBe(true);
    expect(rDup.history.past.length).toBe(depth);
  });

  it('空栈撤销/重做为安全无操作', () => {
    const h = initHistory(initialAppState());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
