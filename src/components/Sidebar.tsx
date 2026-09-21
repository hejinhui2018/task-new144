import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';
import { batchProgress } from '../core/selectors';
import { BatchChip } from './StatusChip';

export function Sidebar() {
  const { state, activeBatchId, selectBatch, run } = useStore();
  const [name, setName] = useState('');
  const create = () => {
    const r = run({ id: uid(), type: 'CREATE_BATCH', name });
    if (r.ok && r.meta?.batchId) selectBatch(r.meta.batchId);
    setName('');
  };
  return (
    <aside className="sidebar">
      <h2>换型批次</h2>
      {state.batchOrder.length === 0 && <p className="muted">暂无批次,从下方新建。</p>}
      <ul className="batch-list">
        {state.batchOrder.map((id) => {
          const b = state.batches[id];
          const prog = batchProgress(b);
          return (
            <li key={id}>
              <button className={`batch-item ${id === activeBatchId ? 'active' : ''}`} onClick={() => selectBatch(id)}>
                <span className="batch-title">
                  {b.id} · {b.name}
                </span>
                <span className="batch-sub">
                  <BatchChip status={b.status} decision={b.closeDecision} />
                  <span className="muted">
                    {prog.done}/{prog.total} 步
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="create-box">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新批次名称(可空)"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn btn-primary" onClick={create}>
          新建批次
        </button>
      </div>
      <p className="muted small">数据保存在本浏览器 localStorage,刷新/重启后自动恢复(含撤销栈)。</p>
    </aside>
  );
}
