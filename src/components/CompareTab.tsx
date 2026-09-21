import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { compareBatches } from '../core/compare';

export function CompareTab() {
  const { state } = useStore();
  const order = state.batchOrder;
  const [aId, setAId] = useState(order[order.length - 2] ?? '');
  const [bId, setBId] = useState(order[order.length - 1] ?? '');
  const aEff = state.batches[aId] ? aId : order[0] ?? '';
  const bEff = state.batches[bId] ? bId : order[order.length - 1] ?? '';
  const a = aEff ? state.batches[aEff] : null;
  const b = bEff ? state.batches[bEff] : null;

  if (order.length < 2) {
    return (
      <section className="card">
        <h3>批次对比</h3>
        <p className="muted">至少需要两个批次才能对比;可从运行中批次的检查点「派生」一个续跑批次。</p>
      </section>
    );
  }

  const result = a && b ? compareBatches(a, b) : null;
  const cellText = (c: { exec: string; generation: number; invalidations: number; signed: boolean } | null) =>
    c ? `${c.exec} · 第${c.generation + 1}代${c.invalidations ? ` · 失效${c.invalidations}次` : ''}${c.signed ? ' · 已签收' : ''}` : '—';

  return (
    <section className="card">
      <h3>批次对比</h3>
      <div className="compare-selects">
        <select value={aEff} onChange={(e) => setAId(e.target.value)}>
          {order.map((id) => (
            <option key={id} value={id}>
              {id} {state.batches[id].name}
            </option>
          ))}
        </select>
        <span className="muted">对比</span>
        <select value={bEff} onChange={(e) => setBId(e.target.value)}>
          {order.map((id) => (
            <option key={id} value={id}>
              {id} {state.batches[id].name}
            </option>
          ))}
        </select>
      </div>
      {result && (
        <>
          {result.frozenDiffs.length > 0 && (
            <>
              <h4>冻结基线差异</h4>
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>基线项</th>
                    <th>{aEff}</th>
                    <th>{bEff}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frozenDiffs.map((d) => (
                    <tr key={d.field}>
                      <td>{d.field}</td>
                      <td>{d.a}</td>
                      <td>{d.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h4>步骤执行差异</h4>
          <table className="cmp-table">
            <thead>
              <tr>
                <th>步骤</th>
                <th>{aEff} 状态</th>
                <th>{aEff} 证据(有效/失效)</th>
                <th>{bEff} 状态</th>
                <th>{bEff} 证据(有效/失效)</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.stepId} className={r.changed ? 'changed' : ''}>
                  <td>
                    {r.stepId} {r.name}
                  </td>
                  <td>{cellText(r.a)}</td>
                  <td>{r.a ? `${r.a.validEvidence}/${r.a.supersededEvidence}` : '—'}</td>
                  <td>{cellText(r.b)}</td>
                  <td>{r.b ? `${r.b.validEvidence}/${r.b.supersededEvidence}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">高亮行为两批次存在差异的步骤。</p>
        </>
      )}
    </section>
  );
}
