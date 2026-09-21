import { useState } from 'react'
import type { ChangeoverTemplate } from '../engine/types'
import { allLateReceipts , type RunState} from '../engine/engine'
import { useActions } from './useActions'
import { Modal } from './Modal'
import { fmtTime } from './format'

/** 待核对区：关闭后/失效代际的迟到回执 */
export function LateReceiptsPanel({ tpl, run }: { tpl: ChangeoverTemplate; run: RunState }) {
  const { act } = useActions()
  const [target, setTarget] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const late = allLateReceipts(run)

  return (
    <div>
      {late.length === 0 && <div className="muted small">暂无迟到回执。关闭后到达的检测结果会进入此处，且不会覆盖放行结论。</div>}
      {late.map((e) => {
        const def = tpl.steps.find((s) => s.id === e.stepId)
        return (
          <div key={e.id} className={`ev late ${e.reconciled ? 'stale' : ''}`} style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>
              <strong>{def?.code}</strong> {e.label}：
              <span className={`res ${e.result}`} style={{ marginLeft: 4 }}>{e.result === 'pass' ? '合格' : e.result === 'fail' ? '不合格' : '记录'}</span>
            </span>
            <span className="muted small">{fmtTime(e.recordedAt)} · 第 {e.gen + 1} 代</span>
            {e.reconciled ? (
              <span className={`chip ${e.reconciled === 'accepted' ? 'done' : 'skipped'}`}>
                已{e.reconciled === 'accepted' ? '采纳（仅备案）' : '驳回'}：{e.reconcileNote}
              </span>
            ) : (
              <button className="tiny danger" onClick={() => { setTarget(e.id); setNote('') }}>核对</button>
            )}
          </div>
        )
      })}
      {target && (
        <Modal title="核对迟到回执" onClose={() => setTarget(null)}>
          <div className="muted small" style={{ marginBottom: 8 }}>
            核对结果仅作备案与追溯，<strong>不会修改已冻结的放行依据</strong>，也不会让任何旧证据恢复有效。
          </div>
          <label>核对备注</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：留样复核，判定为取样偏差" />
          <div className="foot">
            <button onClick={() => setTarget(null)}>取消</button>
            <button className="danger" disabled={!note.trim()}
              onClick={() => { act((at) => ({ kind: 'reconcileLateReceipt', evidenceId: target, accepted: false, note: note.trim(), at, by: '班组长' }), '已驳回备案'); setTarget(null) }}>
              驳回
            </button>
            <button className="primary" disabled={!note.trim()}
              onClick={() => { act((at) => ({ kind: 'reconcileLateReceipt', evidenceId: target, accepted: true, note: note.trim(), at, by: '班组长' }), '已采纳备案（依据不变）'); setTarget(null) }}>
              采纳备案
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
