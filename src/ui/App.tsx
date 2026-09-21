import { useMemo, useState } from 'react'
import { TEMPLATES, getTemplate } from '../engine/template'
import { criticalPath, allLateReceipts } from '../engine/engine'
import { useWorld } from './useStore'
import { useActions } from './useActions'
import { StationBoard, ReleasePanel } from './StationBoard'
import { FrozenPanel } from './FrozenPanel'
import { StepCard } from './StepCard'
import { LateReceiptsPanel } from './LateReceiptsPanel'
import { DeriveModal, CompareModal, BasisModal, LogPanel } from './Modals'
import { ReasonPrompt, Modal } from './Modal'
import { STATUS_TEXT, fmtDateTime } from './format'
import type { EvidenceResult } from '../engine/types'

type SideTab = 'release' | 'late' | 'log' | 'checkpoints'

export default function App() {
  const world = useWorld()
  const { store, act } = useActions()
  const runs = Object.values(world).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const active = runs.find((r) => r.status === 'running' || r.status === 'paused')
  const [selectedId, setSelectedId] = useState<string>('')
  const view = world[selectedId] ?? active ?? runs[runs.length - 1]
  const tpl = view ? getTemplate(view.templateId) : TEMPLATES[0]
  const cpSet = useMemo(() => criticalPath(tpl), [tpl])

  const [side, setSide] = useState<SideTab>('release')
  const [modal, setModal] = useState<null | 'pause' | 'terminate' | 'checkpoint' | 'derive' | 'compare' | 'basis' | 'welcome'>(
    runs.length === 0 ? 'welcome' : null,
  )
  const [receiptTarget, setReceiptTarget] = useState<null | { stepId: string; kindId: string; label: string }>(null)

  const lateCount = view ? allLateReceipts(view).filter((e) => !e.reconciled).length : 0

  const startNew = (templateId: string) => {
    const runId = `run-${store.mintId('r')}`
    const d = act((at) => ({ kind: 'startRun', runId, templateId, at, by: '当班操作人' }), `批次 ${runId} 已开始，现场基线已冻结`)
    if (d.ok) {
      setSelectedId(runId)
      setModal(null)
    }
  }

  const deliver = (result: EvidenceResult) => {
    if (!receiptTarget) return
    act(
      (at) => ({ kind: 'deliverReceipt', stepId: receiptTarget.stepId, kindId: receiptTarget.kindId, result, at, by: '检测室' }),
      result === 'fail' ? '回执已送达（不合格）' : '回执已送达',
    )
    setReceiptTarget(null)
  }

  return (
    <div className="app">
      <div className="app-header">
        <h1>🏭 LineClear 换型放行演练台</h1>
        <span className="sub">{tpl.name}</span>
        <div className="spacer" />
        {view && (
          <select value={view.id} onChange={(e) => setSelectedId(e.target.value)} style={{ maxWidth: 230 }}>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.id} · {STATUS_TEXT[r.status]} · {fmtDateTime(r.createdAt)}</option>)}
          </select>
        )}
        {view && <span className={`run-status ${view.status}`}>{STATUS_TEXT[view.status]}</span>}
        <button onClick={() => setModal('welcome')}>＋ 新批次</button>
        <button onClick={() => store.undo()} disabled={!store.canUndo()}>↶ 撤销</button>
        <button onClick={() => store.redo()} disabled={!store.canRedo()}>↷ 重做</button>
        <button onClick={() => setModal('compare')} disabled={runs.length === 0}>⇌ 批次对比</button>
        <button className="danger" onClick={() => { if (confirm('确认清空全部本地演练数据？')) store.resetAll() }}>清空</button>
      </div>

      {!view && (
        <div className="panel">
          <p>本地暂无批次数据。点击右上角「＋ 新批次」开始一次换型放行演练；数据只保存在本浏览器 localStorage。</p>
        </div>
      )}

      {view && (
        <div className="layout">
          <div>
            {view.pauseReason && (
              <div className="panel" style={{ borderColor: 'var(--amber)', background: '#fffdf5' }}>
                <strong>⏸ 批次已暂停：</strong>{view.pauseReason}
              </div>
            )}
            {view.terminatedReason && (
              <div className="panel" style={{ borderColor: 'var(--red)', background: '#fff8f8' }}>
                <strong>⛔ 批次已提前终止：</strong>{view.terminatedReason}
                <div className="muted small">可在右侧建立/使用检查点派生新批次续作。</div>
              </div>
            )}

            <div className="panel">
              <h2>🔒 冻结基线（开始时锁定，全程不可更改）</h2>
              <FrozenPanel frozen={view.frozen!} derivedFrom={view.derivedFrom} />
            </div>

            <div className="panel">
              <h2>🏗 工位状态</h2>
              <StationBoard tpl={tpl} run={view} />
            </div>

            <div className="panel">
              <h2>📋 换型步骤（含前置依赖与工位互锁）</h2>
              <div className="muted small" style={{ marginBottom: 8 }}>
                红色左框为<strong>关键路径</strong>（CPM 零松弛）；步骤可按拓扑顺序展开，导轨/视觉支线可并行，但同一互锁工位同时只允许一个执行中步骤。
              </div>
              {tpl.steps.map((s) => (
                <StepCard key={s.id} tpl={tpl} run={view} stepId={s.id} critical={cpSet.has(s.id)}
                  onDeliver={(stepId, kindId, label) => setReceiptTarget({ stepId, kindId, label })} />
              ))}
            </div>
          </div>

          <div>
            <div className="side-tabs">
              <button className={side === 'release' ? 'on' : ''} onClick={() => setSide('release')}>🚦 放行依据/阻塞</button>
              <button className={side === 'late' ? 'on' : ''} onClick={() => setSide('late')}>
                📨 待核对区{lateCount > 0 && <span className="count-badge" style={{ marginLeft: 4 }}>{lateCount}</span>}
              </button>
              <button className={side === 'checkpoints' ? 'on' : ''} onClick={() => setSide('checkpoints')}>📌 检查点</button>
              <button className={side === 'log' ? 'on' : ''} onClick={() => setSide('log')}>🧾 事件日志</button>
            </div>

            <div className="panel">
              {side === 'release' && (
                <>
                  <h2>放行门禁</h2>
                  <ReleasePanel
                    tpl={tpl}
                    run={view}
                    onClose={() => {
                      const d = act((at) => ({ kind: 'closeRun', at, by: '班组长刘芳' }))
                      if (d.ok) setModal('basis')
                    }}
                    onTerminate={() => setModal('terminate')}
                    onCheckpoint={() => setModal('checkpoint')}
                    onDerive={() => setModal('derive')}
                  />
                  <div className="sep" />
                  <div className="row">
                    {view.status === 'running' && <button onClick={() => setModal('pause')}>⏸ 暂停</button>}
                    {view.status === 'paused' && <button className="primary" onClick={() => act((at) => ({ kind: 'resumeRun', at, by: '班组长刘芳' }), '已恢复')}>▶ 恢复续作</button>}
                    {view.status === 'closed' && <button onClick={() => setModal('basis')}>查看放行依据</button>}
                  </div>
                </>
              )}
              {side === 'late' && (
                <>
                  <h2>📨 待核对区（迟到回执）</h2>
                  <LateReceiptsPanel tpl={tpl} run={view} />
                </>
              )}
              {side === 'checkpoints' && (
                <>
                  <h2>📌 检查点</h2>
                  {view.checkpoints.length === 0 && <div className="muted small">运行中可在「放行门禁」页建立检查点，用于中断续作与结果继承。</div>}
                  {view.checkpoints.map((c) => (
                    <div key={c.id} className="ev" style={{ marginBottom: 6 }}>
                      <span className="chip cp">检查点</span>
                      <strong style={{ flex: 1 }}>{c.label}</strong>
                      <span className="muted small">{fmtDateTime(c.at)} · 事件序号 #{c.seq}</span>
                    </div>
                  ))}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button onClick={() => setModal('checkpoint')} disabled={view.status !== 'running' && view.status !== 'paused'}>📌 新建检查点</button>
                    <button onClick={() => setModal('derive')} disabled={view.checkpoints.length === 0}>🧬 从检查点派生续作批次</button>
                  </div>
                </>
              )}
              {side === 'log' && (
                <>
                  <h2>🧾 审计事件日志（{store.getJournal().length}）</h2>
                  <LogPanel />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 */}
      {modal === 'welcome' && (
        <Modal title="开始一次换型放行演练" onClose={() => setModal(null)}>
          <p className="muted">开始后将立即冻结：产品版本、设备配置、岗位、检查标准。全部操作记入审计日志，可撤销/重做、刷新恢复。</p>
          {TEMPLATES.map((t) => (
            <div key={t.id} className="basis-step">
              <div className="h">{t.name}</div>
              <div className="muted small">{t.steps.length} 个步骤 · {t.stations.length} 个工位 · 导轨/灌装/视觉三线协同</div>
              <div className="foot">
                <button className="primary" onClick={() => startNew(t.id)}>开始并冻结基线</button>
              </div>
            </div>
          ))}
        </Modal>
      )}
      {modal === 'pause' && (
        <ReasonPrompt title="暂停批次" confirmText="暂停" onCancel={() => setModal(null)}
          onConfirm={(reason) => { act((at) => ({ kind: 'pauseRun', at, by: '班组长刘芳', reason }), '已暂停'); setModal(null) }} />
      )}
      {modal === 'terminate' && (
        <ReasonPrompt title="提前终止批次" confirmText="确认终止" danger onCancel={() => setModal(null)}
          onConfirm={(reason) => { act((at) => ({ kind: 'terminateRun', at, by: '班组长刘芳', reason }), '批次已终止'); setModal(null) }} />
      )}
      {modal === 'checkpoint' && (
        <CheckpointPrompt
          onCancel={() => setModal(null)}
          onConfirm={(label) => { act((at) => ({ kind: 'createCheckpoint', label, at }), `检查点「${label}」已建立`); setModal(null) }}
        />
      )}
      {modal === 'derive' && <DeriveModal onClose={() => { setSelectedId(''); setModal(null) }} />}
      {modal === 'compare' && <CompareModal onClose={() => setModal(null)} />}
      {modal === 'basis' && view && <BasisModal run={view} onClose={() => setModal(null)} />}

      {receiptTarget && (
        <Modal title={`送达检测回执：${receiptTarget.label}`} onClose={() => setReceiptTarget(null)}>
          <div className="muted small" style={{ marginBottom: 10 }}>
            演练模拟实验室/视觉系统回执。批次已关闭或证据代际已失效时，回执将只进入<strong>待核对区</strong>，不覆盖当班结论。
          </div>
          <div className="row">
            <button className="primary" onClick={() => deliver('pass')}>回执：合格</button>
            <button className="danger" onClick={() => deliver('fail')}>回执：不合格</button>
            <button onClick={() => setReceiptTarget(null)}>取消</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CheckpointPrompt({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (label: string) => void }) {
  const [label, setLabel] = useState('')
  return (
    <Modal title="建立检查点" onClose={onCancel}>
      <label>检查点名称</label>
      <input style={{ width: '100%' }} autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：导轨段完成、白班交接点" />
      <div className="foot">
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={!label.trim()} onClick={() => onConfirm(label.trim())}>建立</button>
      </div>
    </Modal>
  )
}
