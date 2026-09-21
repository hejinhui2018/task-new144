import { useMemo, useState } from 'react'
import type { Event } from '../engine/types'
import { effectiveEvidence, compareRuns, type RunState } from '../engine/engine'
import { getTemplate } from '../engine/template'
import { useStore } from './useStore'
import { useActions } from './useActions'
import { Modal } from './Modal'
import { fmtDateTime, fmtTime, STATUS_TEXT } from './format'

// ---------- 派生新批次 ----------

export function DeriveModal({ onClose }: { onClose: () => void }) {
  const { store, act } = useActions()
  const world = store.getWorld()
  const candidates = Object.values(world).filter((r) => r.checkpoints.length > 0)
  const [sourceId, setSourceId] = useState(candidates[0]?.id ?? '')
  const [cpId, setCpId] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const source = world[sourceId]
  const cp = source?.checkpoints.find((c) => c.id === cpId) ?? source?.checkpoints[source.checkpoints.length - 1]
  const tpl = source ? getTemplate(source.templateId) : undefined
  const snapshot = source && cp ? store.snapshotAt(source.id, cp.seq) : undefined

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setPicked(next)
  }

  const confirm = () => {
    if (!source || !cp) return
    const newRunId = `run-${store.mintId('r')}`
    const d = act(
      (at) => ({
        kind: 'deriveRun',
        newRunId,
        sourceRunId: source.id,
        checkpointId: cp.id,
        inheritStepIds: [...picked],
        at,
        by: '班组长',
      }),
      `已派生新批次 ${newRunId}，继承 ${picked.size} 个步骤的有效结果`,
    )
    if (d.ok) onClose()
  }

  return (
    <Modal title="从检查点派生新批次（中断续作）" onClose={onClose} width={760}>
      {candidates.length === 0 ? (
        <div className="muted">当前没有任何批次建立过检查点。运行中点击「📌 建检查点」后即可在此派生续作批次。</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <label>源批次</label>
            <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPicked(new Set()); setCpId('') }}>
              {candidates.map((r) => <option key={r.id} value={r.id}>{r.id}（{STATUS_TEXT[r.status]}，{r.checkpoints.length} 个检查点）</option>)}
            </select>
            <label>检查点</label>
            <select value={cp?.id ?? ''} onChange={(e) => { setCpId(e.target.value); setPicked(new Set()) }}>
              {source?.checkpoints.map((c) => <option key={c.id} value={c.id}>{c.label} · {fmtDateTime(c.at)}</option>)}
            </select>
          </div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            仅检查点时刻<strong>已完成且已签收、证据有效</strong>的步骤可继承；继承的步骤直接标记完成并携带来源标注，其余步骤重新执行。
          </div>
          <div className="checklist">
            {tpl && snapshot && tpl.steps.map((s) => {
              const st = snapshot.steps[s.id]
              const inheritable = st.status === 'done' && !!st.signedBy && effectiveEvidence(snapshot, s.id).length > 0
              return (
                <label key={s.id} className={inheritable ? '' : 'disabled'}>
                  <input type="checkbox" disabled={!inheritable} checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span>
                    <strong>{s.code}</strong> {s.title}
                    {' '}<span className={`chip ${st.status}`}>{STATUS_TEXT[st.status]}</span>
                    {inheritable
                      ? <span className="muted small"> · {st.signedBy} 签收 · {effectiveEvidence(snapshot, s.id).length} 份有效证据可继承</span>
                      : <span className="muted small"> · 检查点时刻不可继承</span>}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="foot">
            <button onClick={onClose}>取消</button>
            <button className="primary" onClick={confirm} disabled={!cp}>派生并继承 {picked.size} 项</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------- 批次对比 ----------

export function CompareModal({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const world = store.getWorld()
  const runs = Object.values(world)
  const [aId, setAId] = useState(runs[0]?.id ?? '')
  const [bId, setBId] = useState(runs[1]?.id ?? runs[0]?.id ?? '')
  const a = world[aId]
  const b = world[bId]
  const tpl = a ? getTemplate(a.templateId) : undefined
  const cmp = useMemo(() => (a && b && tpl ? compareRuns(tpl, a, b) : null), [a, b, tpl])

  const cell = (x: { status: string; gen: number; effectivePass: number; inherited: boolean; signedBy?: string }) => (
    <td>
      <span className={`chip ${x.status}`}>{STATUS_TEXT[x.status]}</span>{' '}
      <span className="chip gen">{x.gen + 1} 代</span>{' '}
      合格证据 {x.effectivePass}{x.inherited && <span className="chip inherited">继承</span>}
    </td>
  )

  return (
    <Modal title="批次对比" onClose={onClose} width={820}>
      {runs.length < 1 ? (
        <div className="muted">还没有批次。</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <label>批次 A</label>
            <select value={aId} onChange={(e) => setAId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select>
            <label>批次 B</label>
            <select value={bId} onChange={(e) => setBId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select>
          </div>
          {cmp && (
            <table className="data">
              <thead>
                <tr><th>步骤</th><th>{aId}</th><th>{bId}</th></tr>
              </thead>
              <tbody>
                {cmp.steps.map((s) => (
                  <tr key={s.code} className={s.same ? '' : 'diff'}>
                    <td><strong>{s.code}</strong> {s.title}{!s.same && <span className="chip critical" style={{ marginLeft: 6 }}>差异</span>}</td>
                    {cell(s.a)}{cell(s.b)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  )
}

// ---------- 放行依据 ----------

export function BasisModal({ run, onClose }: { run: RunState; onClose: () => void }) {
  const basis = run.closedBasis
  if (!basis) return null
  return (
    <Modal title={`放行依据（不可变快照） · ${basis.runId}`} onClose={onClose} width={780}>
      <dl className="kv">
        <dt>放行时间</dt><dd>{fmtDateTime(basis.closedAt)} {fmtTime(basis.closedAt)}</dd>
        <dt>放行人</dt><dd>{basis.closedBy}</dd>
        <dt>换入产品</dt><dd>{basis.frozen.productTo.sku} {basis.frozen.productTo.name}（{basis.frozen.productTo.spec}）</dd>
        <dt>检查标准</dt><dd>{basis.frozen.standards.map((s) => `${s.id} ${s.version}`).join('；')}</dd>
        <dt>迟到回执</dt><dd>{basis.lateReceiptsExcluded} 份被排除在本依据之外（见待核对区）</dd>
      </dl>
      <div className="sep" />
      {basis.steps.map((s) => (
        <div key={s.code} className="basis-step">
          <div className="h">
            <span>{s.code}</span><span>{s.title}</span>
            <span className={`chip ${s.status}`}>{STATUS_TEXT[s.status]}</span>
            {s.inherited && <span className="chip inherited">继承</span>}
            {s.skipReason && <span className="chip skipped">跳过：{s.skipReason}</span>}
          </div>
          <div className="muted small">{s.station} · {s.signed ? `签收：${s.signedBy}` : '未签收'}</div>
          <div className="small" style={{ marginTop: 3 }}>
            {s.evidence.length === 0 ? (
              <span className="muted">无计入依据的证据</span>
            ) : (
              s.evidence.map((e) => (
                <span key={e.id} className="ev" style={{ display: 'inline-flex', marginRight: 6, marginBottom: 3 }}>
                  {e.label}：<span className={`res ${e.result}`}>{e.result === 'pass' ? '合格' : e.result === 'fail' ? '不合格' : '记录'}</span>
                  {e.inherited && <span className="chip inherited">继承</span>}
                  <span className="muted">{e.by}</span>
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </Modal>
  )
}

// ---------- 事件日志 ----------

const EVENT_TEXT: Record<string, string> = {
  RunStarted: '开始批次（冻结基线）',
  RunPaused: '暂停',
  RunResumed: '恢复',
  RunClosed: '放行关闭',
  RunTerminated: '提前终止',
  StepStarted: '步骤开始',
  StepCompleted: '步骤完成',
  StepSigned: '步骤签收',
  StepSkipped: '步骤跳过',
  StepRetested: '步骤复测',
  StepRolledBack: '参数回退',
  StepInvalidated: '下游失效传播',
  EvidenceRecorded: '记录证据',
  ReceiptDelivered: '回执送达',
  InheritedResult: '继承检查点结果',
  CheckpointCreated: '建立检查点',
  LateReceiptRecorded: '迟到回执进待核对区',
  LateReceiptReconciled: '核对迟到回执',
}

export function LogPanel() {
  const { store } = useActions()
  const entries = [...store.getJournal()].reverse()
  return (
    <div className="log">
      {entries.length === 0 && <div className="muted">暂无事件</div>}
      {entries.map((e) => (
        <div key={e.seq} className="ln">
          <span className="seq">#{e.seq}</span>
          <span className="t">{fmtTime(e.ev.at)}</span>
          <span>[{e.runId}]</span>
          <span>{EVENT_TEXT[e.ev.type] ?? e.ev.type}</span>
          {eventDetail(e.ev) && <span className="t">{eventDetail(e.ev)}</span>}
        </div>
      ))}
    </div>
  )
}

function eventDetail(ev: Event): string {
  switch (ev.type) {
    case 'StepStarted':
    case 'StepCompleted':
    case 'StepSigned':
    case 'StepSkipped':
    case 'StepRetested':
    case 'StepRolledBack':
    case 'StepInvalidated':
      return ev.stepId
    case 'EvidenceRecorded':
    case 'LateReceiptRecorded':
      return `${ev.stepId} ${ev.label} ${ev.result}`
    case 'ReceiptDelivered':
      return `${ev.evidenceId} ${ev.result}`
    case 'LateReceiptReconciled':
      return `${ev.evidenceId} ${ev.accepted ? '采纳' : '驳回'}`
    case 'CheckpointCreated':
      return `${ev.label} #${ev.seq}`
    case 'RunStarted':
      return `${ev.runId} ${ev.templateId}`
    case 'RunPaused':
    case 'RunTerminated':
      return ev.reason
    case 'InheritedResult':
      return `${ev.stepId} ← ${ev.fromRunId}@${ev.checkpointId}`
    default:
      return ''
  }
}
