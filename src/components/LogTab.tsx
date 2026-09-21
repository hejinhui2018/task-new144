import { Batch, EventKind } from '../core/types';

const KIND_LABEL: Record<EventKind, string> = {
  batch: '批次',
  step: '步骤',
  evidence: '证据',
  release: '放行',
  derive: '派生',
  review: '核对',
};

export function LogTab({ batch }: { batch: Batch }) {
  const events = [...batch.events].sort((a, b) => b.seq - a.seq);
  return (
    <section className="card">
      <h3>事件日志</h3>
      {events.length === 0 ? (
        <p className="muted">暂无事件</p>
      ) : (
        <ul className="log-list">
          {events.map((e) => (
            <li key={e.seq}>
              <span className="log-seq">#{e.seq}</span>
              <span className="log-at">T+{e.at}</span>
              <span className={`chip kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
