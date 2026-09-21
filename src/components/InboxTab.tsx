import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';
import { ConfirmInline } from './ConfirmInline';

/** 待核对区:批次关闭后到达的迟到回执;另附迟到回执模拟器用于演练 */
export function InboxTab() {
  const { state, run } = useStore();
  const [sim, setSim] = useState({ batchId: '', stepId: '', title: '', value: '', by: '', gen: '' });
  const simBatch = sim.batchId ? state.batches[sim.batchId] : null;
  const simValid = simBatch && sim.stepId && sim.title.trim() && sim.by.trim();

  const submitSim = () => {
    if (!simBatch) return;
    run({
      id: uid(),
      type: 'SUBMIT_EVIDENCE',
      batchId: simBatch.id,
      stepId: sim.stepId,
      title: sim.title,
      value: sim.value,
      submittedBy: sim.by,
      forGeneration: sim.gen.trim() ? Math.max(0, Number(sim.gen) - 1) : undefined,
    });
    setSim({ batchId: sim.batchId, stepId: sim.stepId, title: '', value: '', by: sim.by, gen: '' });
  };

  return (
    <section className="card">
      <h3>待核对区(迟到回执)</h3>
      <p className="muted">批次关闭后到达的回执只进入此区;核对采纳/驳回仅决定归档去向,不改写已关闭批次的结论。</p>
      {state.lateInbox.length === 0 ? (
        <p className="muted">暂无待核对回执。</p>
      ) : (
        <ul className="inbox-list">
          {state.lateInbox.map((ev) => (
            <li key={ev.id} className="ev-item late">
              <div className="late-main">
                <div>
                  <span className="ev-id">{ev.id}</span> <strong>{ev.title}</strong>{' '}
                  <span className="muted">
                    批次 {ev.batchId} · 步骤 {ev.stepId} · 第{ev.generation + 1}代 · {ev.submittedBy} · T+{ev.at}
                  </span>
                </div>
                {ev.value && <p>{ev.value}</p>}
              </div>
              <div className="late-actions">
                <ConfirmInline
                  small
                  label="采纳归档"
                  fields={[
                    { key: 'reviewer', placeholder: '核对人', required: true },
                    { key: 'note', placeholder: '核对意见' },
                  ]}
                  onConfirm={(v) =>
                    run({ id: uid(), type: 'REVIEW_LATE_EVIDENCE', evidenceId: ev.id, accept: true, note: v.note ?? '', reviewer: v.reviewer })
                  }
                />
                <ConfirmInline
                  small
                  danger
                  label="驳回"
                  fields={[
                    { key: 'reviewer', placeholder: '核对人', required: true },
                    { key: 'note', placeholder: '驳回原因' },
                  ]}
                  onConfirm={(v) =>
                    run({ id: uid(), type: 'REVIEW_LATE_EVIDENCE', evidenceId: ev.id, accept: false, note: v.note ?? '', reviewer: v.reviewer })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <hr />
      <h4>模拟迟到回执</h4>
      <p className="muted small">
        对已关闭批次提交 → 进入上方待核对区;对运行中批次提交过期代次 → 直接归档为失效证据,不覆盖当前结论。
      </p>
      <div className="sim-form">
        <select value={sim.batchId} onChange={(e) => setSim((s) => ({ ...s, batchId: e.target.value, stepId: '' }))}>
          <option value="">选择批次</option>
          {state.batchOrder.map((id) => (
            <option key={id} value={id}>
              {id} {state.batches[id].name}
              {state.batches[id].status === 'closed' ? '(已关闭)' : ''}
            </option>
          ))}
        </select>
        <select value={sim.stepId} onChange={(e) => setSim((s) => ({ ...s, stepId: e.target.value }))} disabled={!simBatch}>
          <option value="">选择步骤</option>
          {simBatch?.template.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} {t.name}(当前第{simBatch.steps[t.id].generation + 1}代)
            </option>
          ))}
        </select>
        <input placeholder="证据标题 *" value={sim.title} onChange={(e) => setSim((s) => ({ ...s, title: e.target.value }))} />
        <input placeholder="测定值/结论" value={sim.value} onChange={(e) => setSim((s) => ({ ...s, value: e.target.value }))} />
        <input placeholder="提交人 *" value={sim.by} onChange={(e) => setSim((s) => ({ ...s, by: e.target.value }))} />
        <input
          placeholder="对应代次(留空=当前代)"
          type="number"
          value={sim.gen}
          onChange={(e) => setSim((s) => ({ ...s, gen: e.target.value }))}
        />
        <button className="btn btn-primary" disabled={!simValid} onClick={submitSim}>
          提交回执
        </button>
      </div>
    </section>
  );
}
