import type { ChangeoverTemplate } from '../engine/types'
import { stationViews, releaseGate , type RunState} from '../engine/engine'

export function StationBoard({ tpl, run }: { tpl: ChangeoverTemplate; run: RunState }) {
  const views = stationViews(tpl, run)
  return (
    <div className="station-board">
      {views.map((v) => (
        <div key={v.id} className={`station ${v.occupant ? 'busy' : ''}`}>
          <div className="name">
            {v.name}
            {v.exclusive && <span className="lock-badge">互锁</span>}
          </div>
          {v.occupant ? (
            <div className="occ">⛓ {v.occupant.code} {v.occupant.title} 执行中，同工位其他步骤被锁定</div>
          ) : (
            <div className="free">空闲</div>
          )}
        </div>
      ))}
    </div>
  )
}

export function ReleasePanel({ tpl, run, onClose, onTerminate, onCheckpoint, onDerive }: {
  tpl: ChangeoverTemplate
  run: RunState
  onClose: () => void
  onTerminate: () => void
  onCheckpoint: () => void
  onDerive: () => void
}) {
  const blockers = releaseGate(tpl, run)
  const closed = run.status === 'closed'
  return (
    <div>
      {!closed && (
        <>
          {blockers.length === 0 ? (
            <div style={{ color: 'var(--green)', fontWeight: 600 }}>✅ 全部步骤已完成并签收，满足放行条件</div>
          ) : (
            <div className="blockers">
              <strong>放行阻塞（{blockers.length}）：</strong>
              <ul>
                {blockers.map((b, i) => {
                  const text =
                    b.kind === 'prereq' ? `${b.code}《${b.title}》仍为${{ pending: '未开始', in_progress: '执行中', done: '已完成', skipped: '已跳过' }[b.state]}`
                    : b.kind === 'in-progress' ? '存在执行中的步骤'
                    : b.kind === 'unsigned' ? '存在已完成但未签收的步骤'
                    : b.kind === 'critical-skip' ? '关键放行步骤被跳过'
                    : '存在已跳过步骤'
                  return <li key={i}>{text}</li>
                })}
              </ul>
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={run.status !== 'running' || blockers.length > 0} onClick={onClose}>✅ 质量签收并放行关闭</button>
            <button onClick={onCheckpoint} disabled={run.status !== 'running' && run.status !== 'paused'}>📌 建检查点</button>
            <button onClick={onDerive} disabled={run.status === 'running' || run.status === 'paused'} title="需先关闭或终止当前批次">🧬 从检查点派生新批次</button>
            <button className="danger" onClick={onTerminate} disabled={run.status !== 'running' && run.status !== 'paused'}>⛔ 提前终止</button>
          </div>
          {run.status !== 'running' && <div className="muted small" style={{ marginTop: 6 }}>批次处于「{run.status === 'paused' ? '已暂停' : run.status}」状态，部分操作需先恢复。</div>}
        </>
      )}
      {closed && (
        <div>
          <div style={{ color: 'var(--primary)', fontWeight: 700 }}>🔒 批次已于 {new Date(run.closedBasis!.closedAt).toLocaleString('zh-CN')} 由 {run.closedBasis!.closedBy} 放行关闭，放行依据已冻结不可变。</div>
          <div className="muted small" style={{ marginTop: 4 }}>此后到达的检测回执只会进入「待核对区」，不覆盖当班结论。</div>
        </div>
      )}
    </div>
  )
}
