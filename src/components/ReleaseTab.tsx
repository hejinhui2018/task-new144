import { Batch } from '../core/types';
import { EXEC_LABEL, releaseBlockers } from '../core/selectors';
import { ConfirmInline } from './ConfirmInline';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';

/** 放行依据:逐步核对完成/签收状态,全部满足才允许放行 */
export function ReleaseTab({ batch }: { batch: Batch }) {
  const { run } = useStore();

  if (batch.status === 'closed' && batch.release) {
    const r = batch.release;
    return (
      <section className="card">
        <h3>{r.decision === 'released' ? '放行记录' : '提前终止记录'}</h3>
        <dl className="record">
          <dt>结论</dt>
          <dd>{r.decision === 'released' ? '放行' : '提前终止'}</dd>
          <dt>操作人</dt>
          <dd>{r.operator}</dd>
          <dt>时间</dt>
          <dd>T+{r.at}</dd>
          {r.reason && (
            <>
              <dt>原因</dt>
              <dd>{r.reason}</dd>
            </>
          )}
          <dt>完成步骤</dt>
          <dd>{r.basis.doneSteps.join('、') || '无'}</dd>
          <dt>跳过步骤</dt>
          <dd>{r.basis.skippedSteps.join('、') || '无'}</dd>
          <dt>有效证据</dt>
          <dd>
            {r.basis.validEvidence} 份(失效留存 {r.basis.supersededEvidence} 份)
          </dd>
          <dt>签收</dt>
          <dd>{r.basis.signoffs.map((s) => `${s.stepId}:${s.signedBy}`).join('、') || '无'}</dd>
        </dl>
        <p className="muted">批次已关闭;此后到达的回执只进入「待核对区」,不会改写本记录。</p>
      </section>
    );
  }

  const blockers = releaseBlockers(batch);
  return (
    <section className="card">
      <h3>放行依据核对</h3>
      <ul className="check-list">
        {batch.template.map((t) => {
          const s = batch.steps[t.id];
          const done = s.exec === 'done' || s.exec === 'skipped';
          const needSign = s.exec === 'done' && !s.signedBy;
          return (
            <li key={t.id} className={done && !needSign ? 'ok' : 'bad'}>
              <span>
                {t.id} {t.name}
              </span>
              <span>
                {EXEC_LABEL[s.exec]}
                {needSign ? ' · 待签收' : ''}
                {s.signedBy ? ` · 已签收:${s.signedBy}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {blockers.length > 0 ? (
        <div className="blockers-box">
          <strong>暂不具备放行条件:</strong>
          <ul>
            {blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ok-text">✓ 全部步骤完成并签收,具备放行条件。</p>
      )}
      <div className="release-actions">
        <ConfirmInline
          label="确认放行"
          fields={[{ key: 'operator', placeholder: '放行人', required: true }]}
          onConfirm={(v) => run({ id: uid(), type: 'CLOSE_BATCH', batchId: batch.id, decision: 'released', reason: '', operator: v.operator })}
        />
        <ConfirmInline
          label="提前终止"
          danger
          fields={[
            { key: 'reason', placeholder: '终止原因', required: true },
            { key: 'operator', placeholder: '操作人', required: true },
          ]}
          onConfirm={(v) => run({ id: uid(), type: 'CLOSE_BATCH', batchId: batch.id, decision: 'terminated', reason: v.reason, operator: v.operator })}
        />
      </div>
    </section>
  );
}
