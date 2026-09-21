import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventStore } from '../engine/store'
import { getTemplate } from '../engine/template'
import { releaseGate } from '../engine/engine'
import { StoreProvider } from './useStore'
import { ToastProvider } from './toast'
import App from './App'
import type { EvidenceResult } from '../engine/types'

const TPL_ID = 'tpl-b250-to-b1000'

function makeStore() {
  let t = 1_000_000
  return new EventStore({ now: vi.fn(() => (t += 60_000)) }, null)
}

function executeStep(store: EventStore, stepId: string) {
  const tpl = getTemplate(TPL_ID)
  const def = tpl.steps.find((s) => s.id === stepId)!
  expect(store.dispatch({ kind: 'startStep', stepId, at: store.now(), by: def.role }).ok).toBe(true)
  for (const k of def.evidenceKinds) {
    expect(store.dispatch({ kind: 'recordEvidence', stepId, kindId: k.id, result: 'pass', at: store.now(), by: def.role }).ok).toBe(true)
    if (k.async) {
      expect(store.dispatch({ kind: 'deliverReceipt', stepId, kindId: k.id, result: 'pass' as EvidenceResult, at: store.now(), by: '检测室' }).ok).toBe(true)
    }
  }
  expect(store.dispatch({ kind: 'completeStep', stepId, at: store.now(), by: def.role }).ok).toBe(true)
  expect(store.dispatch({ kind: 'signStep', stepId, at: store.now(), by: def.role }).ok).toBe(true)
}

function render(store: EventStore) {
  return renderToStaticMarkup(
    <StoreProvider store={store}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>,
  )
}

describe('App 整页渲染冒烟', () => {
  it('空状态可渲染', () => {
    const html = render(makeStore())
    expect(html).toContain('LineClear')
    expect(html).toContain('新批次')
  })

  it('运行中批次：冻结基线、工位板、步骤、阻塞原因、关键路径均可渲染', () => {
    const store = makeStore()
    expect(store.dispatch({ kind: 'startRun', runId: 'run-ui', templateId: TPL_ID, at: store.now(), by: '夜班' }).ok).toBe(true)
    executeStep(store, 's10')
    const html = render(store)
    expect(html).toContain('冻结基线')
    expect(html).toContain('1000ml 大瓶')
    expect(html).toContain('工位状态')
    expect(html).toContain('导轨工位')
    expect(html).toContain('关键路径')
    expect(html).toContain('放行门禁')
    // s20 已可执行，s30 因前置未完成而阻塞
    expect(html).toContain('阻塞原因')
  })

  it('关闭放行后：放行依据与待核对区入口可渲染，迟到回执显示在待核对区', () => {
    const store = makeStore()
    expect(store.dispatch({ kind: 'startRun', runId: 'run-ui2', templateId: TPL_ID, at: store.now(), by: '夜班' }).ok).toBe(true)
    for (const id of ['s10', 's20', 's22', 's30', 's40', 's44', 's50', 's60', 's70']) executeStep(store, id)
    const run = store.getWorld()['run-ui2']
    expect(releaseGate(getTemplate(TPL_ID), run)).toHaveLength(0)
    expect(store.dispatch({ kind: 'closeRun', at: store.now(), by: '刘芳' }).ok).toBe(true)
    // 关闭后迟到回执
    expect(store.dispatch({ kind: 'deliverReceipt', stepId: 's50', kindId: 'ev-dim-report', result: 'fail', at: store.now(), by: '检测室' }).ok).toBe(true)
    const html = render(store)
    expect(html).toContain('已放行关闭')
    expect(html).toContain('待核对区')
    expect(html).toContain('首件尺寸报告')
    expect(html).toContain('模拟迟到回执')
  })
})
