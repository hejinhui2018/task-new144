import { useState } from 'react';
import { Batch, StepTemplate } from '../core/types';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';
import { criticalPath } from '../core/dependency';
import { stationName, stationOccupant, stepBlockers, supersededEvidence, validEvidence } from '../core/selectors';
import { ExecChip } from './StatusChip';
import { ConfirmInline } from './ConfirmInline';
import { DeriveModal } from './DeriveModal';

export function Board({ batch, goRelease }: { batch: Batch; goRelease: () => void }) {
  const cp = criticalPath(batch.template);
  const cpSet = new Set(cp.path);
  const remaining = batch.template
    .filter((t) => cpSet.has(t.id) && batch.steps[t.id].exec !== 'done' && batch.steps[t.id].exec !== 'skipped')
    .reduce((s, t) => s + t.estimatedMinutes, 0);
  return (
    <div className="board">
      <FrozenCard batch={batch} />
      <BatchControls batch={batch} goRelease={goRelease} />
      <div className="cp-bar">
        <span className="cp-label">关键路径</span>
        <span className="cp-path">
          {cp.path.map((id) => `${id} ${batch.template.find((t) => t.id === id)?.name ?? ''}`).join(' → ')}
        </span>
        <span className="cp-minutes">
          共约 {cp.minutes} 分钟{remaining > 0 ? ` · 剩余约 ${remaining} 分钟` : ' · 已全部完成'}
        </span>
      </div>
      <div className="stations">
        {batch.stations.map((st) => (
          <StationColumn key={st.id} batch={batch} stationId={st.id} cpSet={cpSet} />
        ))}
      </div>
    </div>
  );
}

function FrozenCard({ batch }: { batch: Batch }) {
  const f = batch.frozen;
  if (!f) return null;
  return (
    <section className="card frozen-card">
      <header>
        <h3>冻结基线</h3>
        <span className="seal">已冻结 · T+{f.frozenAt}</span>
      </header>
      <div className="frozen-grid">
        <div>
          <label>产品版本</label>
          <p>{f.productVersion}</p>
        </div>
        <div>
          <label>设备配置</label>
          <p>{f.equipmentConfig}</p>
        </div>
        <div>
          <label>检查标准</label>
          <p>{f.inspectionStandard}</p>
        </div>
        <div>
          <label>岗位值守</label>
          <p>{f.posts.map((p) => `${p.postName}:${p.operator || '—'}`).join(' / ')}</p>
        </div>
      </div>
      {batch.derivedFrom && (
        <p className="derived-note">
          派生自 {batch.derivedFrom.batchId} 检查点 {batch.derivedFrom.checkpointStepId}
        </p>
      )}
    </section>
  );
}

function BatchControls({ batch, goRelease }: { batch: Batch; goRelease: () => void }) {
  const { run } = useStore();
  if (batch.status === 'closed') {
    return (
      <section className={`card close-banner ${batch.closeDecision ?? ''}`}>
        <strong>{batch.closeDecision === 'released' ? '✓ 批次已放行' : '✕ 批次已提前终止'}</strong>
        <span>
          关闭于 T+{batch.closedAt}
          {batch.closeReason ? ` · ${batch.closeReason}` : ''}
        </span>
        <span className="muted">关闭后到达的回执只进入「待核对区」,不会改动本批结论。</span>
      </section>
    );
  }
  if (batch.status === 'interrupted') {
    return (
      <section className="card control-bar interrupted">
        <span className="warn-text">⚠ 批次已中断,进行中的步骤已自动暂停</span>
        <button className="btn btn-primary" onClick={() => run({ id: uid(), type: 'RESUME_BATCH', batchId: batch.id })}>
          续作
        </button>
      </section>
    );
  }
  return (
    <section className="card control-bar">
      <ConfirmInline
        label="中断"
        fields={[{ key: 'reason', placeholder: '中断原因(如交接班)', required: true }]}
        onConfirm={(v) => run({ id: uid(), type: 'INTERRUPT_BATCH', batchId: batch.id, reason: v.reason })}
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
      <button className="btn btn-primary" onClick={goRelease}>
        前往放行 →
      </button>
    </section>
  );
}

function StationColumn({ batch, stationId, cpSet }: { batch: Batch; stationId: string; cpSet: Set<string> }) {
  const occ = stationOccupant(batch, stationId);
  const steps = batch.template.filter((t) => t.stationId === stationId);
  return (
    <div className="station">
      <header className="station-head">
        <h4>{stationName(batch, stationId)}</h4>
        {occ ? <span className="chip occ">占用 · {occ}</span> : <span className="chip free">空闲</span>}
      </header>
      {steps.map((t) => (
        <StepCard key={t.id} batch={batch} tpl={t} onCp={cpSet.has(t.id)} />
      ))}
    </div>
  );
}

function StepCard({ batch, tpl, onCp }: { batch: Batch; tpl: StepTemplate; onCp: boolean }) {
  const { run } = useStore();
  const st = batch.steps[tpl.id];
  const [deriving, setDeriving] = useState(false);
  const blockers = st.exec === 'idle' ? stepBlockers(batch, tpl.id) : [];
  const startable = st.exec === 'idle' && blockers.length === 0;
  const running = batch.status === 'running';
  const bid = batch.id;

  return (
    <div className={`step-card exec-${st.exec} ${onCp ? 'on-cp' : ''}`}>
      <div className="step-head">
        <span className="step-id">{tpl.id}</span>
        <span className="step-name">{tpl.name}</span>
        {tpl.kind === 'checkpoint' && <span className="chip cp">检查点</span>}
      </div>
      <div className="step-meta">
        <ExecChip exec={st.exec} invalidations={st.invalidations} />
        {st.signedBy && <span className="chip signed">签收 · {st.signedBy}</span>}
        {st.inheritedFrom && <span className="chip inherited">继承自 {st.inheritedFrom}</span>}
        <span className="muted">约{tpl.estimatedMinutes}′</span>
      </div>
      <p className="step-desc">{tpl.description}</p>

      {st.exec === 'idle' && blockers.length > 0 && batch.status !== 'closed' && (
        <ul className="blockers">
          {blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {st.exec === 'paused' && st.pauseReason && <p className="pause-reason">暂停:{st.pauseReason}</p>}
      {st.exec === 'skipped' && st.skipReason && <p className="pause-reason">跳过:{st.skipReason}</p>}

      <EvidenceBlock batch={batch} tpl={tpl} />

      <div className="step-actions">
        {startable && (
          <ConfirmInline
            small
            label="开始"
            fields={[{ key: 'operator', placeholder: '执行人/岗位', required: true }]}
            onConfirm={(v) => run({ id: uid(), type: 'START_STEP', batchId: bid, stepId: tpl.id, operator: v.operator })}
          />
        )}
        {st.exec === 'in_progress' && running && (
          <>
            <ConfirmInline
              small
              label="暂停"
              fields={[{ key: 'reason', placeholder: '暂停原因', required: true }]}
              onConfirm={(v) => run({ id: uid(), type: 'PAUSE_STEP', batchId: bid, stepId: tpl.id, reason: v.reason })}
            />
            <CompleteButton batch={batch} tpl={tpl} />
          </>
        )}
        {st.exec === 'paused' && running && (
          <button className="btn btn-sm btn-primary" onClick={() => run({ id: uid(), type: 'RESUME_STEP', batchId: bid, stepId: tpl.id })}>
            继续
          </button>
        )}
        {st.exec === 'done' && running && (
          <>
            {!st.signedBy && (
              <ConfirmInline
                small
                label="签收"
                fields={[{ key: 'signer', placeholder: '签收人', required: true }]}
                onConfirm={(v) => run({ id: uid(), type: 'SIGN_OFF', batchId: bid, stepId: tpl.id, signer: v.signer })}
              />
            )}
            <ConfirmInline
              small
              label="复测"
              fields={[
                { key: 'reason', placeholder: '复测原因', required: true },
                { key: 'operator', placeholder: '操作人', required: true },
              ]}
              onConfirm={(v) => run({ id: uid(), type: 'RETEST_STEP', batchId: bid, stepId: tpl.id, reason: v.reason, operator: v.operator })}
            />
            <ConfirmInline
              small
              label="回退"
              danger
              fields={[
                { key: 'reason', placeholder: '回退原因', required: true },
                { key: 'operator', placeholder: '操作人', required: true },
              ]}
              onConfirm={(v) => run({ id: uid(), type: 'ROLLBACK_STEP', batchId: bid, stepId: tpl.id, reason: v.reason, operator: v.operator })}
            />
          </>
        )}
        {st.exec === 'skipped' && running && (
          <ConfirmInline
            small
            label="回退"
            danger
            fields={[
              { key: 'reason', placeholder: '回退原因', required: true },
              { key: 'operator', placeholder: '操作人', required: true },
            ]}
            onConfirm={(v) => run({ id: uid(), type: 'ROLLBACK_STEP', batchId: bid, stepId: tpl.id, reason: v.reason, operator: v.operator })}
          />
        )}
        {st.exec === 'idle' && running && blockers.length === 0 && (
          <ConfirmInline
            small
            label="跳过"
            fields={[
              { key: 'reason', placeholder: '跳过原因', required: true },
              { key: 'operator', placeholder: '操作人', required: true },
            ]}
            onConfirm={(v) => run({ id: uid(), type: 'SKIP_STEP', batchId: bid, stepId: tpl.id, reason: v.reason, operator: v.operator })}
          />
        )}
        {tpl.kind === 'checkpoint' && st.exec === 'done' && (
          <button className="btn btn-sm btn-ghost" onClick={() => setDeriving(true)}>
            ⑂ 从此检查点派生
          </button>
        )}
      </div>
      {deriving && <DeriveModal source={batch} checkpointId={tpl.id} onClose={() => setDeriving(false)} />}
    </div>
  );
}

function CompleteButton({ batch, tpl }: { batch: Batch; tpl: StepTemplate }) {
  const { run } = useStore();
  const fields = tpl.requiresEvidence
    ? [
        { key: 'title', placeholder: '证据标题', required: true },
        { key: 'value', placeholder: '测定值/结论', required: true },
        { key: 'operator', placeholder: '执行人', required: true },
      ]
    : [
        { key: 'operator', placeholder: '执行人', required: true },
        { key: 'title', placeholder: '证据标题(可选)' },
        { key: 'value', placeholder: '测定值(可选)' },
      ];
  return (
    <ConfirmInline
      small
      label="完成"
      fields={fields}
      onConfirm={(v) =>
        run({
          id: uid(),
          type: 'COMPLETE_STEP',
          batchId: batch.id,
          stepId: tpl.id,
          operator: v.operator,
          evidence: v.title?.trim() ? { title: v.title, value: v.value ?? '' } : undefined,
        })
      }
    />
  );
}

function EvidenceBlock({ batch, tpl }: { batch: Batch; tpl: StepTemplate }) {
  const { run } = useStore();
  const [showOld, setShowOld] = useState(false);
  const st = batch.steps[tpl.id];
  const valid = validEvidence(batch, tpl.id);
  const superseded = supersededEvidence(batch, tpl.id);
  const running = batch.status === 'running';

  return (
    <div className="evidence">
      {valid.map((ev) => (
        <div key={ev.id} className="ev-item valid">
          <span className="ev-id">{ev.id}</span>
          <span className="ev-title">{ev.title}</span>
          {ev.value && <span className="ev-value">{ev.value}</span>}
          <span className="muted">
            {ev.submittedBy} · T+{ev.at}
            {ev.inheritedFromBatch ? ` · 继承自 ${ev.inheritedFromBatch}` : ''}
          </span>
        </div>
      ))}
      {superseded.length > 0 && (
        <button className="link" onClick={() => setShowOld((s) => !s)}>
          失效证据 {superseded.length} 份 {showOld ? '▲' : '▼'}
        </button>
      )}
      {showOld &&
        superseded.map((ev) => (
          <div key={ev.id} className="ev-item superseded">
            <span className="ev-id">{ev.id}</span>
            <span className="ev-title">
              {ev.title}(第{ev.generation + 1}代,已失效)
            </span>
            <span className="muted">
              {ev.submittedBy} · T+{ev.at}
            </span>
          </div>
        ))}
      {running && (
        <ConfirmInline
          small
          label="补交证据"
          fields={[
            { key: 'title', placeholder: '证据标题', required: true },
            { key: 'value', placeholder: '测定值' },
            { key: 'by', placeholder: '提交人', required: true },
            { key: 'gen', placeholder: `对应代次(当前第${st.generation + 1}代,留空=当前)`, type: 'number' },
          ]}
          onConfirm={(v) =>
            run({
              id: uid(),
              type: 'SUBMIT_EVIDENCE',
              batchId: batch.id,
              stepId: tpl.id,
              title: v.title,
              value: v.value ?? '',
              submittedBy: v.by,
              forGeneration: v.gen?.trim() ? Math.max(0, Number(v.gen) - 1) : undefined,
            })
          }
        />
      )}
    </div>
  );
}
