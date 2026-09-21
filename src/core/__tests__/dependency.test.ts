import { describe, expect, it } from 'vitest';
import { criticalPath, transitiveDependents, transitiveDeps } from '../dependency';
import { TEMPLATE } from '../template';

describe('依赖图(默认换型模板)', () => {
  it('传递下游:灌装参数影响试运行及以后全部步骤', () => {
    const down = new Set(transitiveDependents(TEMPLATE, 'S4'));
    expect(down).toEqual(new Set(['S6', 'S7', 'S8', 'S9', 'S10']));
  });

  it('传递上游:放行签收依赖所有步骤', () => {
    const up = new Set(transitiveDeps(TEMPLATE, 'S10'));
    expect(up.size).toBe(TEMPLATE.length - 1);
  });

  it('清场是首步,无传递上游', () => {
    expect(transitiveDeps(TEMPLATE, 'S1')).toEqual([]);
    expect(new Set(transitiveDependents(TEMPLATE, 'S1'))).toEqual(
      new Set(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']),
    );
  });

  it('关键路径取估计工时最长链', () => {
    const cp = criticalPath(TEMPLATE);
    expect(cp.minutes).toBe(145);
    expect(cp.path).toEqual(['S1', 'S3', 'S4', 'S6', 'S7', 'S8', 'S10']);
  });
});
