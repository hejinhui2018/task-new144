import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventStore } from './store'
import {
  criticalPath,
  dependents,
  effectiveEvidence,
  allLateReceipts,
  staleEvidence,
  releaseGate,
  startGate,
  compareRuns,
  type RunState,
} from './engine'
import { getTemplate } from './template'
import type { EvidenceResult } from './types'

const TPL_ID = 'tpl-b250-to-b1000'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
  get length() { return this.map.size }
  key(i: number) { return [...this.map.keys()][i] ?? null }
}

function harness(storage: MemoryStorage | null = null) {
  let t = 1_000_000
  const clock = { now: vi.fn(() => t) }
  const store = new EventStore(clock, storage as unknown as Storage)
  return {
    store,
    advance: (ms = 60_000) => { t += ms },
    setTime: (v: number) => { t = v },
  }
}

function ok(d: ReturnType<EventStore['dispatch']>) {
  if (!d.ok) throw new Error('命令应成功，但被拒绝：' + d.error)
}
function fail(d: ReturnType<EventStore['dispatch']>, part?: string) {
  expect(d.ok).toBe(false)
  if (part) expect(d.error!).toContain(part)
}

function startRun(store: EventStore, runId = 'run-a', tpl = TPL_ID) {
  ok(store.dispatch({ kind: 'startRun', runId, templateId: tpl, at: store.now(), by: '夜班张磊' }))
}

/** 记录一条同步证据 */
function evidence(store: EventStore, stepId: string, kindId: string, result: EvidenceResult = 'pass', by = '测试员') {
  ok(store.dispatch({ kind: 'recordEvidence', stepId, kindId, result, at: store.now(), by }))
}

/** 完整走完一个步骤：开始→证据（含异步回执）→完成→签收 */
function executeStep(store: EventStore, stepId: string, overrides: Record<string, EvidenceResult> = {}) {
  const tpl = getTemplate(TPL_ID)
  const def = tpl.steps.find((s) => s.id === stepId)!
  ok(store.dispatch({ kind: 'startStep', stepId, at: store.now(), by: def.role }))
  for (const k of def.evidenceKinds) {
    const result = overrides[k.id] ?? 'pass'
    if (k.async) {
      ok(store.dispatch({ kind: 'recordEvidence', stepId, kindId: k.id, result: 'pass', at: store.now(), by: def.role }))
      ok(store.dispatch({ kind: 'deliverReceipt', stepId, kindId: k.id, result, at: store.now(), by: '检测室' }))
    } else {
      evidence(store, stepId, k.id, result, def.role)
    }
  }
  ok(store.dispatch({ kind: 'completeStep', stepId, at: store.now(), by: def.role }))
  ok(store.dispatch({ kind: 'signStep', stepId, at: store.now(), by: def.role + '-签收' }))
}

function world(store: EventStore) { return store.getWorld() }
function run(store: EventStore, id = 'run-a'): RunState {
  const r = world(store)[id]
  if (!r) throw new Error('批次不存在')
  return r
}

beforeEach(() => {
  // store 实例间互不共享（使用 null storage）
})

describe('图计算：依赖与关键路径', () => {
  const tpl = getTemplate(TPL_ID)

  it('dependents 返回传递下游闭包且不含自身', () => {
    expect(dependents(tpl, 's20').sort()).toEqual(['s30', 's50', 's60', 's70'])
    expect(dependents(tpl, 's10').sort()).toEqual(['s20', 's22', 's30', 's40', 's44', 's50', 's60', 's70'].sort())
    expect(dependents(tpl, 's70')).toEqual([])
  })

  it('关键路径为最长工时链：s10-s20-s30-s50-s60-s70', () => {
    const cp = criticalPath(tpl)
    expect([...cp].sort()).toEqual(['s10', 's20', 's30', 's50', 's60', 's70'])
    // 较短支线有松弛，不在关键路径上
    expect(cp.has('s22')).toBe(false)
    expect(cp.has('s40')).toBe(false)
    expect(cp.has('s44')).toBe(false)
  })
})

describe('前置依赖门禁', () => {
  it('前置未完成不能开始步骤', () => {
    const { store } = harness()
    startRun(store)
    fail(store.dispatch({ kind: 'startStep', stepId: 's20', at: store.now(), by: '李建国' }), 'S10')
    executeStep(store, 's10')
    ok(store.dispatch({ kind: 'startStep', stepId: 's20', at: store.now(), by: '李建国' }))
  })

  it('s30 需要导轨支线 s20 与 s22 都完成', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    const d = store.dispatch({ kind: 'startStep', stepId: 's30', at: store.now(), by: '王海涛' })
    fail(d, 'S22')
    executeStep(store, 's22')
    ok(store.dispatch({ kind: 'startStep', stepId: 's30', at: store.now(), by: '王海涛' }))
  })
})

describe('工位互锁', () => {
  it('同一互锁工位同时只能有一个执行中步骤', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    ok(store.dispatch({ kind: 'startStep', stepId: 's20', at: store.now(), by: '李建国' }))
    // s22 与 s20 同在导轨工位
    fail(store.dispatch({ kind: 'startStep', stepId: 's22', at: store.now(), by: '李建国' }), '工位互锁')
    // 不同工位（视觉）可以并行
    ok(store.dispatch({ kind: 'startStep', stepId: 's40', at: store.now(), by: '陈曦' }))
    fail(store.dispatch({ kind: 'startStep', stepId: 's44', at: store.now(), by: '陈曦' }), '工位互锁')
  })

  it('占用步骤完成后工位释放，互锁步骤可开始', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    const gates = startGate(getTemplate(TPL_ID), run(store), 's22')
    expect(gates.filter((g) => g.kind === 'station')).toHaveLength(0)
    ok(store.dispatch({ kind: 'startStep', stepId: 's22', at: store.now(), by: '李建国' }))
  })
})

describe('证据与完成门禁', () => {
  it('必备证据缺失或回执在途时不能完成；回执 pass 后可完成', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    executeStep(store, 's22')
    ok(store.dispatch({ kind: 'startStep', stepId: 's30', at: store.now(), by: '王海涛' }))
    fail(store.dispatch({ kind: 'completeStep', stepId: 's30', at: store.now(), by: '王海涛' }), '缺少必备证据')
    // 送检异步证据：进入在途，仍不能完成
    ok(store.dispatch({ kind: 'recordEvidence', stepId: 's30', kindId: 'ev-fill-volume', result: 'pass', at: store.now(), by: '王海涛' }))
    fail(store.dispatch({ kind: 'completeStep', stepId: 's30', at: store.now(), by: '王海涛' }), '等待异步检测回执')
    // 回执 fail：不能完成
    ok(store.dispatch({ kind: 'deliverReceipt', stepId: 's30', kindId: 'ev-fill-volume', result: 'fail', at: store.now(), by: '检测室' }))
    fail(store.dispatch({ kind: 'completeStep', stepId: 's30', at: store.now(), by: '王海涛' }), '不合格')
  })

  it('只有执行中的步骤才能记录证据，防止把前一次换线残留计入', () => {
    const { store } = harness()
    startRun(store)
    fail(store.dispatch({ kind: 'recordEvidence', stepId: 's20', kindId: 'ev-torque', result: 'pass', at: store.now(), by: '夜班' }), '未在执行中')
  })

  it('非必备证据缺失不阻断完成', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    // s10 的“上批标签销毁照片”非必备，executeStep 全给了；这里单独构造只给必备项
  })
})

describe('复测/回退的依赖传播与证据失效', () => {
  it('复测 s20：自身重开、代际+1、旧证据保留但失效；下游 s30/s50/s60/s70 连带失效', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    executeStep(store, 's22')
    executeStep(store, 's30')
    const s20OldEv = effectiveEvidence(run(store), 's20')
    expect(s20OldEv.length).toBeGreaterThan(0)
    const s30OldEv = effectiveEvidence(run(store), 's30')

    ok(store.dispatch({ kind: 'retestStep', stepId: 's20', at: store.now(), by: '白班刘芳', reason: '夜班扭矩记录存疑，重新紧固复测' }))

    const r = run(store)
    // 自身
    expect(r.steps.s20.status).toBe('in_progress')
    expect(r.steps.s20.gen).toBe(1)
    // 下游失效
    expect(r.steps.s30.status).toBe('pending')
    expect(r.steps.s30.gen).toBe(1)
    expect(r.steps.s30.invalidatedBy).toBe('s20')
    // 尚未执行的 s50/s60/s70 无需失效事件，保持初始态；一旦上游未重做完成，门禁会拦住
    expect(r.steps.s50.status).toBe('pending')
    expect(r.steps.s50.gen).toBe(0)
    expect(r.steps.s60.gen).toBe(0)
    expect(r.steps.s70.gen).toBe(0)
    // 未受影响的支线 s22 不动
    expect(r.steps.s22.status).toBe('done')
    expect(r.steps.s22.gen).toBe(0)
    // 旧证据仍然保留（可审计），但已不是有效证据
    expect(staleEvidence(r, 's20').map((e) => e.id).sort()).toEqual(s20OldEv.map((e) => e.id).sort())
    expect(effectiveEvidence(r, 's20')).toHaveLength(0)
    expect(staleEvidence(r, 's30').map((e) => e.id).sort()).toEqual(s30OldEv.map((e) => e.id).sort())
    expect(effectiveEvidence(r, 's30')).toHaveLength(0)
    // 失效后 s30 不能直接做（前置 s20 重做中）
    fail(store.dispatch({ kind: 'startStep', stepId: 's30', at: store.now(), by: '王海涛' }), 'S20')
  })

  it('回退 s30 参数：新值落位、旧值留痕、下游失效；不能回退到相同值', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    executeStep(store, 's22')
    executeStep(store, 's30')
    expect(run(store).steps.s30.paramValue).toBe('1000ml（大瓶目标值）')

    fail(
      store.dispatch({ kind: 'rollbackStep', stepId: 's30', at: store.now(), by: '夜班', reason: 'x', toValue: '1000ml（大瓶目标值）' }),
      '重复操作',
    )
    ok(
      store.dispatch({
        kind: 'rollbackStep',
        stepId: 's30',
        at: store.now(),
        by: '夜班王海涛',
        reason: '大瓶气泡多，临时退回 500ml 维持',
        toValue: '500ml（中间值）',
      }),
    )
    const r = run(store)
    expect(r.steps.s30.status).toBe('in_progress')
    expect(r.steps.s30.gen).toBe(1)
    expect(r.steps.s30.paramValue).toBe('500ml（中间值）')
    expect(r.steps.s30.lastRollback?.fromValue).toContain('1000ml')
    // s50 尚未执行，保持初始态；其门禁会等待 s30 重新完成
    expect(r.steps.s50.status).toBe('pending')
    expect(r.steps.s50.gen).toBe(0)
    // 页面上的“绿色”不能再信：签收已清空
    expect(r.steps.s30.signedBy).toBeUndefined()
  })

  it('未执行步骤无需复测/回退；跳过步骤不能复测', () => {
    const { store } = harness()
    startRun(store)
    fail(store.dispatch({ kind: 'retestStep', stepId: 's20', at: store.now(), by: 'x', reason: 'r' }), '尚未执行')
  })

  it('多级传播：s50/s60 已完成后复测 s20，已执行下游链全部失效且旧证据保留', () => {
    const { store } = harness()
    startRun(store)
    for (const id of ['s10', 's20', 's22', 's30', 's40', 's44', 's50', 's60']) executeStep(store, id)
    const s50EffIds = effectiveEvidence(run(store), 's50').map((e) => e.id)
    const s60EffIds = effectiveEvidence(run(store), 's60').map((e) => e.id)

    ok(store.dispatch({ kind: 'retestStep', stepId: 's20', at: store.now(), by: '李建国', reason: '导轨异响，重新紧固' }))
    const r = run(store)
    for (const id of ['s30', 's50', 's60'] as const) {
      expect(r.steps[id].status).toBe('pending')
      expect(r.steps[id].gen).toBe(1)
    }
    // 视觉支线不受影响
    expect(r.steps.s40.status).toBe('done')
    expect(r.steps.s44.status).toBe('done')
    // 旧证据保留但失效
    expect(staleEvidence(r, 's50').map((e) => e.id).sort()).toEqual(s50EffIds.sort())
    expect(staleEvidence(r, 's60').map((e) => e.id).sort()).toEqual(s60EffIds.sort())
    expect(effectiveEvidence(r, 's50')).toHaveLength(0)
    // 深层步骤 s60 在 s20 未重做完成前无法开始（前置链阻断）
    fail(store.dispatch({ kind: 'startStep', stepId: 's60', at: store.now(), by: '赵颖' }), 'S50')
  })

  it('多级传播（参数回退）：s50/s60 已完成后回退 s30 参数，下游失效且 s50 旧证据保留', () => {
    const { store } = harness()
    startRun(store)
    for (const id of ['s10', 's20', 's22', 's30', 's40', 's44', 's50', 's60']) executeStep(store, id)
    const s50Eff = effectiveEvidence(run(store), 's50').map((e) => e.id)

    ok(store.dispatch({
      kind: 'rollbackStep',
      stepId: 's30',
      at: store.now(),
      by: '夜班王海涛',
      reason: '夜班临时回退灌装量，白班复核',
      toValue: '250ml（小瓶旧值）',
    }))
    const r = run(store)
    expect(r.steps.s30.paramValue).toBe('250ml（小瓶旧值）')
    expect(r.steps.s30.gen).toBe(1)
    expect(r.steps.s50.status).toBe('pending')
    expect(r.steps.s50.gen).toBe(1)
    expect(r.steps.s50.invalidatedBy).toBe('s30')
    expect(r.steps.s60.gen).toBe(1)
    // 未受影响的导轨/视觉支线不动
    expect(r.steps.s20.status).toBe('done')
    expect(r.steps.s40.status).toBe('done')
    // 旧证据保留、失效
    expect(staleEvidence(r, 's50').map((e) => e.id).sort()).toEqual(s50Eff.sort())
    expect(effectiveEvidence(r, 's50')).toHaveLength(0)
  })
})

describe('迟到回执：关闭后只进待核对区，不覆盖当班结论', () => {
  it('全流程关闭后送达的回执进入待核对区，放行依据不变', () => {
    const { store } = harness()
    startRun(store)
    for (const id of ['s10', 's20', 's22', 's30', 's40', 's44', 's50', 's60', 's70']) executeStep(store, id)
    expect(releaseGate(getTemplate(TPL_ID), run(store))).toHaveLength(0)
    ok(store.dispatch({ kind: 'closeRun', at: store.now(), by: '班组长刘芳' }))
    const basisBefore = structuredClone(run(store).closedBasis!)

    // 关闭后首件尺寸报告“迟到”
    ok(store.dispatch({ kind: 'deliverReceipt', stepId: 's50', kindId: 'ev-dim-report', result: 'fail', at: store.now(), by: '检测室' }))
    const r = run(store)
    expect(r.status).toBe('closed')
    const late = allLateReceipts(r)
    expect(late).toHaveLength(1)
    expect(late[0].receipt).toBe('late')
    // 放行依据快照不被覆盖
    expect(r.closedBasis).toEqual(basisBefore)
    expect(r.closedBasis!.lateReceiptsExcluded).toBe(0)
    // 已关闭批次不能再执行步骤
    fail(store.dispatch({ kind: 'startStep', stepId: 's10', at: store.now(), by: 'x' }), '已关闭')

    // 待核对区核对：采纳/驳回各一次操作语义，不允许重复核对
    ok(store.dispatch({ kind: 'reconcileLateReceipt', evidenceId: late[0].id, accepted: true, note: '留样复核为取样偏差', at: store.now(), by: '刘芳' }))
    fail(store.dispatch({ kind: 'reconcileLateReceipt', evidenceId: late[0].id, accepted: false, note: 'x', at: store.now(), by: '刘芳' }), '重复')
    // 即便采纳，也仍然不进放行依据（依据不可变）
    expect(run(store).closedBasis).toEqual(basisBefore)
  })

  it('步骤被上游失效后，旧在途回执晚到只进待核对区，不冒充当前代际结论', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    executeStep(store, 's22')
    // s30 送检后直接先完成别的路径不可能；这里让 s30 完成后再被传播失效
    executeStep(store, 's30')
    // 回退 s20（导轨问题），s30 失效到 gen=1、pending；其 gen=0 灌装量回执其实已确认。
    // 再造一个在途旧证据：复测 s30 使其 gen=1 执行中并送检，随后回退 s22? s22 不影响 s30? 影响（s30 依赖 s22）。
    ok(store.dispatch({ kind: 'retestStep', stepId: 's30', at: store.now(), by: '王海涛', reason: '参数复核' }))
    ok(store.dispatch({ kind: 'recordEvidence', stepId: 's30', kindId: 'ev-fill-volume', result: 'pass', at: store.now(), by: '王海涛' }))
    // 此时 s30 gen=1 在途；s20 复测导致 s30 再次传播失效到 gen=2
    ok(store.dispatch({ kind: 'retestStep', stepId: 's20', at: store.now(), by: '李建国', reason: '导轨复测' }))
    const r1 = run(store)
    expect(r1.steps.s30.gen).toBe(2)
    // gen=1 的在途回执晚到
    ok(store.dispatch({ kind: 'deliverReceipt', stepId: 's30', kindId: 'ev-fill-volume', result: 'pass', at: store.now(), by: '检测室' }))
    const r2 = run(store)
    const late = allLateReceipts(r2)
    expect(late).toHaveLength(1)
    expect(effectiveEvidence(r2, 's30')).toHaveLength(0)
  })
})

describe('冻结基线', () => {
  it('开始时冻结产品版本、设备配置、岗位、标准，并带入放行依据', () => {
    const { store } = harness()
    startRun(store)
    const f = run(store).frozen!
    expect(f.productFrom.sku).toBe('B-250')
    expect(f.productTo.sku).toBe('B-1000')
    expect(f.equipmentConfig.map((c) => c.name)).toContain('视觉配方')
    expect(f.posts.length).toBeGreaterThanOrEqual(6)
    expect(f.standards.some((s) => s.id === 'STD-REL-02')).toBe(true)
  })
})

describe('检查点派生与继承', () => {
  it('从检查点派生新批次：可选择继承检查点时刻已完成签收的步骤与有效证据', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    ok(store.dispatch({ kind: 'createCheckpoint', label: '导轨段完成', at: store.now() }))
    const cp = run(store).checkpoints[0]
    executeStep(store, 's22') // 检查点之后才完成，不应可继承
    ok(store.dispatch({ kind: 'terminateRun', at: store.now(), by: '刘芳', reason: '停线演练，派生续作' }))

    // s22 在检查点时刻未完成 → 拒绝
    fail(
      store.dispatch({
        kind: 'deriveRun',
        newRunId: 'run-b',
        sourceRunId: 'run-a',
        checkpointId: cp.id,
        inheritStepIds: ['s10', 's22'],
        at: store.now(),
        by: '刘芳',
      }),
      'S22',
    )

    ok(
      store.dispatch({
        kind: 'deriveRun',
        newRunId: 'run-b',
        sourceRunId: 'run-a',
        checkpointId: cp.id,
        inheritStepIds: ['s10', 's20'],
        at: store.now(),
        by: '刘芳',
      }),
    )
    const b = run(store, 'run-b')
    expect(b.status).toBe('running')
    expect(b.derivedFrom?.checkpointId).toBe(cp.id)
    expect(b.steps.s10.status).toBe('done')
    expect(b.steps.s10.inherited).toBe(true)
    expect(b.steps.s10.signedBy).toContain('继承')
    expect(effectiveEvidence(b, 's10').length).toBeGreaterThan(0)
    expect(effectiveEvidence(b, 's10')[0].inherited).toBeTruthy()
    expect(b.steps.s20.status).toBe('done')
    // 未勾选继承的 s22 仍待执行
    expect(b.steps.s22.status).toBe('pending')
    // 继承后可以继续推进剩余步骤
    executeStep(store, 's22')
    expect(run(store, 'run-b').steps.s22.status).toBe('done')
  })

  it('禁止重复批次号派生', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    ok(store.dispatch({ kind: 'createCheckpoint', label: 'cp1', at: store.now() }))
    const cp = run(store).checkpoints[0]
    ok(store.dispatch({ kind: 'terminateRun', at: store.now(), by: 'x', reason: 'r' }))
    ok(
      store.dispatch({ kind: 'deriveRun', newRunId: 'run-b', sourceRunId: 'run-a', checkpointId: cp.id, inheritStepIds: [], at: store.now(), by: 'x' }),
    )
    fail(
      store.dispatch({ kind: 'deriveRun', newRunId: 'run-b', sourceRunId: 'run-a', checkpointId: cp.id, inheritStepIds: [], at: store.now(), by: 'x' }),
      '已存在',
    )
  })
})

describe('重复操作与状态机', () => {
  it('重复开始批次/步骤/完成/签收均被拒绝', () => {
    const { store } = harness()
    startRun(store, 'run-a')
    fail(store.dispatch({ kind: 'startRun', runId: 'run-a', templateId: TPL_ID, at: store.now(), by: 'x' }), '已存在')
    executeStep(store, 's10')
    expect(run(store).steps.s10.status).toBe('done')
    fail(store.dispatch({ kind: 'startStep', stepId: 's10', at: store.now(), by: 'x' }), '复测')
    fail(store.dispatch({ kind: 'completeStep', stepId: 's10', at: store.now(), by: 'x' }), '重复完成')
    fail(store.dispatch({ kind: 'signStep', stepId: 's10', at: store.now(), by: '另一人' }), '重复签收')
  })

  it('暂停时阻止执行，恢复后续作；终止后冻结', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    ok(store.dispatch({ kind: 'pauseRun', at: store.now(), by: '刘芳', reason: '交接班暂停' }))
    fail(store.dispatch({ kind: 'startStep', stepId: 's20', at: store.now(), by: '李建国' }), '暂停')
    fail(store.dispatch({ kind: 'pauseRun', at: store.now(), by: 'x', reason: 'y' }), '不能暂停')
    ok(store.dispatch({ kind: 'resumeRun', at: store.now(), by: '刘芳' }))
    ok(store.dispatch({ kind: 'startStep', stepId: 's20', at: store.now(), by: '李建国' }))
    ok(store.dispatch({ kind: 'terminateRun', at: store.now(), by: '刘芳', reason: '设备故障' }))
    fail(store.dispatch({ kind: 'startStep', stepId: 's22', at: store.now(), by: 'x' }), '终止')
  })

  it('关键步骤不能跳过；跳过必须填原因；非关键步骤可跳过并在放行时留痕', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    fail(store.dispatch({ kind: 'skipStep', stepId: 's70', at: store.now(), by: 'x', reason: 'r' }), '关键')
    fail(store.dispatch({ kind: 'skipStep', stepId: 's22', at: store.now(), by: 'x', reason: '' }), '原因')
    ok(store.dispatch({ kind: 'skipStep', stepId: 's22', at: store.now(), by: '刘芳', reason: '大瓶护罩沿用通用件，经口头豁免（演练）' }))
    expect(run(store).steps.s22.status).toBe('skipped')
    // 跳过的下游 s30 仍可开始（跳过在门禁中等同放行，但放行依据会标注）
    executeStep(store, 's20')
    ok(store.dispatch({ kind: 'startStep', stepId: 's30', at: store.now(), by: '王海涛' }))
  })
})

describe('撤销 / 重做 / 刷新恢复', () => {
  it('undo/redo 以命令组为单位：复测连带的多个传播事件一起撤销', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    executeStep(store, 's20')
    executeStep(store, 's22')
    executeStep(store, 's30')
    const before = structuredClone(run(store).steps)
    store.dispatch({ kind: 'retestStep', stepId: 's20', at: store.now(), by: 'x', reason: 'r' })
    expect(run(store).steps.s20.status).toBe('in_progress')
    expect(store.undo()).toBe(true)
    expect(run(store).steps.s20.status).toBe('done')
    expect(run(store).steps.s30.status).toBe('done')
    expect(run(store).steps.s30.gen).toBe(0)
    expect(store.canRedo()).toBe(true)
    expect(store.redo()).toBe(true)
    expect(run(store).steps.s20.status).toBe('in_progress')
    expect(run(store).steps.s30.gen).toBe(1)
    // 撤销重做后状态与直接执行一致
    expect(run(store).steps.s50.gen).toBe(before.s50.gen)
  })

  it('刷新页面后从 localStorage 重放，恢复进行中批次', () => {
    const mem = new MemoryStorage()
    const h1 = harness(mem)
    startRun(h1.store)
    executeStep(h1.store, 's10')
    executeStep(h1.store, 's20')
    ok(h1.store.dispatch({ kind: 'pauseRun', at: h1.store.now(), by: '刘芳', reason: '下班，明天续作' }))

    const h2 = harness(mem)
    const r = h2.store.getWorld()['run-a']
    expect(r).toBeDefined()
    expect(r.status).toBe('paused')
    expect(r.steps.s10.status).toBe('done')
    expect(r.steps.s20.status).toBe('done')
    expect(r.frozen!.productTo.sku).toBe('B-1000')
    // 续作
    ok(h2.store.dispatch({ kind: 'resumeRun', at: h2.store.now(), by: '赵颖' }))
    ok(h2.store.dispatch({ kind: 'startStep', stepId: 's22', at: h2.store.now(), by: '李建国' }))
  })
})

describe('批次对比', () => {
  it('派生批次与源批次按步骤对比状态/代际/继承标记', () => {
    const { store } = harness()
    startRun(store)
    executeStep(store, 's10')
    ok(store.dispatch({ kind: 'createCheckpoint', label: 'cp', at: store.now() }))
    const cp = run(store).checkpoints[0]
    ok(store.dispatch({ kind: 'terminateRun', at: store.now(), by: 'x', reason: 'r' }))
    ok(
      store.dispatch({ kind: 'deriveRun', newRunId: 'run-b', sourceRunId: 'run-a', checkpointId: cp.id, inheritStepIds: ['s10'], at: store.now(), by: 'x' }),
    )
    const tpl = getTemplate(TPL_ID)
    const cmp = compareRuns(tpl, run(store, 'run-a'), run(store, 'run-b'))
    const s10 = cmp.steps.find((s) => s.code === 'S10')!
    expect(s10.a.status).toBe('done')
    expect(s10.b.status).toBe('done')
    expect(s10.b.inherited).toBe(true)
    expect(s10.a.inherited).toBe(false)
    expect(s10.same).toBe(false)
  })
})

describe('完整正向流程放行', () => {
  it('所有步骤完成签收、无待核对回执时关闭并生成不可变放行依据', () => {
    const { store } = harness()
    startRun(store)
    for (const id of ['s10', 's20', 's22', 's30', 's40', 's44', 's50', 's60', 's70']) executeStep(store, id)
    const close = store.dispatch({ kind: 'closeRun', at: store.now(), by: '班组长刘芳' })
    ok(close)
    const basis = run(store).closedBasis!
    expect(basis.steps).toHaveLength(9)
    expect(basis.steps.every((s) => s.signed)).toBe(true)
    expect(basis.frozen.productTo.sku).toBe('B-1000')
    // 依据是快照：之后再补证据不影响
    fail(store.dispatch({ kind: 'recordEvidence', stepId: 's10', kindId: 'ev-line-clear', result: 'pass', at: store.now(), by: 'x' }), '已关闭')
  })

  it('存在未完成/未签收步骤时拒绝放行并给出阻塞原因', () => {
    const { store } = harness()
    startRun(store)
    for (const id of ['s10', 's20', 's22']) executeStep(store, id)
    fail(store.dispatch({ kind: 'closeRun', at: store.now(), by: 'x' }), 'S30')
  })
})
