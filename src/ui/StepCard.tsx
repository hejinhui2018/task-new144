import { useState } from 'react'
import type { ChangeoverTemplate, Evidence, EvidenceResult } from '../engine/types'
import { effectiveEvidence, awaitingEvidence, staleEvidence, formatGate, stepBlockers, type RunState } from '../engine/engine'
import { useActions } from './useActions'
import { Modal, ReasonPrompt } from './Modal'
import { fmtTime } from './format'

const RESULT_LABEL: Record<string, string> = { pass: '合格', fail: '不合格', info: '记录', pending: '待回执' }

export function StepCard({
  tpl,
  run,
  stepId,
  critical,
  onDeliver,
}: {
  tpl: ChangeoverTemplate
  run: RunState
  stepId: string
  critical: boolean
  onDeliver: (stepId: string, kindId: string, label: string) => void
}) {
  const { act } = useActions()
  const [mode, setMode] = useState<null | 'skip' | 'retest' | 'rollback'>(null)
  const def = tpl.steps.find((s) => s.id === stepId)!
  const station = tpl.stations.find((s) => s.id === def.stationId)!
  const st = run.steps[stepId]
  const blockers = stepBlockers(tpl, run)[stepId] ?? []
  const eff = effectiveEvidence(run, stepId)
  const waiting = awaitingEvidence(run, stepId)
  const stale = staleEvidence(run, stepId)

  const running = run.status === 'running'
  const sealed = run.status === 'closed' || run.status === 'terminated'

  return (
    <div className={`step ${st.status} ${critical ? 'critical-step' : ''}`}>
      <div className="step-title">
        <span>{def.code}</span>
        <span>{def.title}</span>
        <span className={`chip ${st.status}`}>{st.status === 'pending' ? '未开始' : st.status === 'in_progress' ? '执行中' : st.status === 'done' ? '已完成' : '已跳过'}</span>
        {critical && <span className="chip critical">关键路径</span>}
        {st.gen > 0 && <span className="chip gen">第 {st.gen + 1} 代</span>}
        {st.inherited && <span className="chip inherited">继承结果</span>}
      </div>
      <div className="step-meta">
        <span>📍 {station.name}{station.exclusive && <span className="lock-badge">互锁工位</span>}</span>
        <span>👤 {def.role}</span>
        <span>⏱ 估时 {def.durationMin} 分钟</span>
        {def.prereq.length > 0 && <span>🔗 前置：{def.prereq.map((p) => tpl.steps.find((x) => x.id === p)?.code).join('、')}</span>}
        {st.signedBy && <span>✍️ {st.signedBy} 于 {fmtTime(st.signedAt)} 签收</span>}
        {st.skipReason && <span>跳过原因：{st.skipReason}</span>}
      </div>

      {def.parameter && (
        <div className="step-meta">
          <span>🔧 参数【{def.parameter.name}】当前值：<strong>{st.paramValue}</strong></span>
          {st.lastRollback && (
            <span className="chip critical" title={`${st.lastRollback.by} ${fmtTime(st.lastRollback.at)}：${st.lastRollback.reason}`}>
              曾回退：{st.lastRollback.fromValue} → {st.lastRollback.toValue}
            </span>
          )}
        </div>
      )}

      {st.status !== 'done' && blockers.length > 0 && (
        <div className="blockers">
          <strong>⛔ 阻塞原因：</strong>
          <ul>{blockers.map((b, i) => <li key={i}>{formatGate(b)}</li>)}</ul>
        </div>
      )}

      <div className="evidence-list">
        {def.evidenceKinds.map((k) => {
          const items = [...eff, ...waiting, ...stale.filter((e) => e.kindId === k.id && !eff.includes(e) && !waiting.includes(e))]
            .filter((e) => e.kindId === k.id)
          return (
            <EvidenceRow
              key={k.id}
              label={k.label}
              required={!!k.required}
              async={!!k.async}
              evidences={items}
              currentGen={st.gen}
              running={running}
              canRecord={running && st.status === 'in_progress'}
              onRecord={(result) =>
                act((at) => ({ kind: 'recordEvidence', stepId, kindId: k.id, result, at, by: def.role }), `已记录：${k.label}`)
              }
              onDeliver={() => onDeliver(stepId, k.id, k.label)}
              sealed={sealed}
            />
          )
        })}
      </div>

      <div className="actions">
        {st.status === 'pending' && (
          <>
            <button className="primary" disabled={!running || blockers.length > 0}
              onClick={() => act((at) => ({ kind: 'startStep', stepId, at, by: def.role }), `${def.code} 已开始`)}>
              开始
            </button>
            {!def.critical && (
              <button disabled={!running} onClick={() => setMode('skip')}>跳过</button>
            )}
          </>
        )}
        {st.status === 'in_progress' && (
          <>
            <button className="primary" disabled={!running || blockers.some((b) => ['evidence-missing', 'evidence-awaiting', 'evidence-fail'].includes(b.kind))}
              onClick={() => act((at) => ({ kind: 'completeStep', stepId, at, by: def.role }), `${def.code} 已完成`)}>
              完成
            </button>
            <button onClick={() => setMode('retest')}>复测</button>
            {def.parameter && <button className="danger" onClick={() => setMode('rollback')}>回退参数</button>}
          </>
        )}
        {st.status === 'done' && !st.signedBy && (
          <button className="primary" disabled={!running}
            onClick={() => act((at) => ({ kind: 'signStep', stepId, at, by: def.role + '/班组长' }), `${def.code} 已签收`)}>
            签收
          </button>
        )}
        {(st.status === 'done' || st.status === 'in_progress') && (
          <button onClick={() => setMode('retest')}>复测</button>
        )}
        {st.status === 'done' && def.parameter && (
          <button className="danger" onClick={() => setMode('rollback')}>回退参数</button>
        )}
        {st.status === 'skipped' && (
          <button onClick={() => setMode('retest')}>取消跳过并复测</button>
        )}
      </div>

      {mode === 'skip' && (
        <ReasonPrompt
          title={`跳过 ${def.code} ${def.title}`}
          confirmText="确认跳过"
          onCancel={() => setMode(null)}
          onConfirm={(reason) => { act((at) => ({ kind: 'skipStep', stepId, at, by: def.role, reason }), '已跳过'); setMode(null) }}
        />
      )}
      {mode === 'retest' && (
        <ReasonPrompt
          title={`复测 ${def.code} ${def.title}`}
          label="复测原因（该步骤重开、代际 +1，受影响下游的既有结果将失效，旧证据保留）"
          confirmText="确认复测"
          danger
          onCancel={() => setMode(null)}
          onConfirm={(reason) => { act((at) => ({ kind: 'retestStep', stepId, at, by: def.role, reason }), '已发起复测，下游受影响结果已失效'); setMode(null) }}
        />
      )}
      {mode === 'rollback' && def.parameter && (
        <RollbackPrompt
          current={st.paramValue ?? def.parameter.values[0]}
          options={def.parameter.values}
          onCancel={() => setMode(null)}
          onConfirm={(toValue, reason) => {
            act((at) => ({ kind: 'rollbackStep', stepId, at, by: def.role, reason, toValue }), '参数已回退，下游受影响结果已失效')
            setMode(null)
          }}
        />
      )}
    </div>
  )
}

function EvidenceRow({
  label,
  required,
  async,
  evidences,
  currentGen,
  canRecord,
  running,
  sealed,
  onRecord,
  onDeliver,
}: {
  label: string
  required: boolean
  async: boolean
  evidences: Evidence[]
  currentGen: number
  canRecord: boolean
  running: boolean
  sealed: boolean
  onRecord: (result: EvidenceResult) => void
  onDeliver: () => void
}) {
  const latest = [...evidences].sort((a, b) => b.recordedAt - a.recordedAt)[0]
  const isStale = !!latest && (latest.receipt === 'late' || latest.gen !== currentGen)
  const isAwaiting = latest?.receipt === 'awaiting'
  return (
    <div className={`ev ${isStale ? (latest!.receipt === 'late' ? 'late' : 'stale') : ''} ${isAwaiting ? 'awaiting' : ''}`}>
      <span style={{ flex: 1, minWidth: 160 }}>
        {required ? '★' : '☆'} {label}
        {async && <span className="muted small">（异步检测）</span>}
      </span>
      {latest ? (
        <>
          <span className={`res ${latest.result}`}>{RESULT_LABEL[latest.result]}</span>
          <span className="muted small">
            {latest.receipt === 'awaiting' ? '已送检·等待回执' : latest.receipt === 'late' ? '迟到·待核对' : isStale ? `旧代际(${latest.gen + 1})已失效` : '有效'}
            {latest.inherited && ' · 继承'} · {latest.recordedBy} · {fmtTime(latest.recordedAt)}
          </span>
          {isAwaiting && (
            <button className="tiny" disabled={!running} onClick={onDeliver}>送达回执</button>
          )}
          {!isAwaiting && async && sealed && (
            <button className="tiny danger" onClick={onDeliver} title="模拟关闭后检测结果才送达">模拟迟到回执</button>
          )}
        </>
      ) : (
        <span className="muted small">
          未记录
          {async && sealed && (
            <button className="tiny danger" style={{ marginLeft: 8 }} onClick={onDeliver} title="模拟关闭后检测结果才送达">模拟迟到回执</button>
          )}
        </span>
      )}
      {canRecord && (
        <span className="row">
          {async ? (
            <button className="tiny" onClick={() => onRecord('pass')}>送检</button>
          ) : (
            <>
              <button className="tiny" onClick={() => onRecord('pass')}>合格</button>
              <button className="tiny danger" onClick={() => onRecord('fail')}>不合格</button>
              <button className="tiny" onClick={() => onRecord('info')}>记录</button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

function RollbackPrompt({
  current,
  options,
  onCancel,
  onConfirm,
}: {
  current: string
  options: string[]
  onCancel: () => void
  onConfirm: (toValue: string, reason: string) => void
}) {
  const [toValue, setToValue] = useState(options.find((v) => v !== current) ?? options[0])
  const [reason, setReason] = useState('')
  return (
    <Modal title="参数回退" onClose={onCancel}>
      <div className="kv">
        <dt>当前值</dt><dd>{current}</dd>
        <dt>回退到</dt>
        <dd>
          <select value={toValue} onChange={(e) => setToValue(e.target.value)}>
            {options.map((v) => <option key={v} value={v} disabled={v === current}>{v}{v === current ? '（当前值）' : ''}</option>)}
          </select>
        </dd>
      </div>
      <div className="sep" />
      <label>回退原因（必填。回退后该步骤重开、代际 +1，下游既有结果失效，旧证据保留）</label>
      <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：大瓶灌装气泡多，夜班临时退回 250ml 维持生产" />
      <div className="foot">
        <button onClick={onCancel}>取消</button>
        <button className="danger" disabled={!reason.trim() || toValue === current}
          onClick={() => onConfirm(toValue, reason.trim())}>确认回退</button>
      </div>
    </Modal>
  )
}
