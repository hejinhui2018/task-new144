import { useMemo, useState } from 'react';
import { Batch } from '../core/types';
import { transitiveDeps } from '../core/dependency';
import { EXEC_LABEL } from '../core/selectors';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';

/** 从检查点派生新批次:仅可继承检查点及其上游的有效结果,继承集自动闭合前置依赖 */
export function DeriveModal({ source, checkpointId, onClose }: { source: Batch; checkpointId: string; onClose: () => void }) {
  const { run, selectBatch } = useStore();
  const candidates = useMemo(() => [checkpointId, ...transitiveDeps(source.template, checkpointId)], [source, checkpointId]);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        candidates.filter((id) => {
          const s = source.steps[id];
          return s.exec === 'done' || s.exec === 'skipped';
        }),
      ),
  );
  const [name, setName] = useState(`${source.name} · 续跑`);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
        for (const d of transitiveDeps(source.template, id)) {
          if (candidates.includes(d)) next.add(d);
        }
      } else {
        next.delete(id);
        for (const other of Array.from(next)) {
          if (transitiveDeps(source.template, other).includes(id)) next.delete(other);
        }
      }
      return next;
    });
  };

  const submit = () => {
    const r = run({
      id: uid(),
      type: 'DERIVE_BATCH',
      sourceBatchId: source.id,
      checkpointStepId: checkpointId,
      inheritStepIds: Array.from(selected),
      name,
    });
    if (!r.ok) {
      setError(r.error ?? '派生失败');
      return;
    }
    if (r.meta?.batchId) selectBatch(r.meta.batchId);
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>从检查点 {checkpointId} 派生新批次</h3>
        <p className="muted">
          仅可继承检查点及其上游的有效结果(完成/跳过);勾选自动带上前置依赖,取消勾选自动解除下游。其余步骤在新批次重新执行。
        </p>
        <ul className="derive-list">
          {candidates.map((id) => {
            const t = source.template.find((x) => x.id === id)!;
            const s = source.steps[id];
            const inheritable = s.exec === 'done' || s.exec === 'skipped';
            return (
              <li key={id}>
                <label className={inheritable ? '' : 'disabled'}>
                  <input type="checkbox" disabled={!inheritable} checked={selected.has(id)} onChange={(e) => toggle(id, e.target.checked)} />
                  <span className="step-id">{id}</span>
                  <span>{t.name}</span>
                  <span className="muted">
                    ({EXEC_LABEL[s.exec]}
                    {inheritable ? '' : ',无有效结果'})
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <input className="derive-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="新批次名称" />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit}>
            派生(已选 {selected.size} 项)
          </button>
          <button className="btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
