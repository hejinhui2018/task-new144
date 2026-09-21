import { BatchStatus, CloseDecision, ExecState } from '../core/types';
import { EXEC_LABEL } from '../core/selectors';

export function ExecChip({ exec, invalidations }: { exec: ExecState; invalidations?: number }) {
  return (
    <span className={`chip exec-${exec}`}>
      {EXEC_LABEL[exec]}
      {invalidations ? <em className="redo-mark">重做×{invalidations}</em> : null}
    </span>
  );
}

export function BatchChip({ status, decision }: { status: BatchStatus; decision: CloseDecision | null }) {
  const label =
    status === 'draft' ? '草稿'
    : status === 'running' ? '运行中'
    : status === 'interrupted' ? '已中断'
    : decision === 'released' ? '已放行'
    : '已终止';
  return <span className={`chip batch-${status} ${decision ?? ''}`}>{label}</span>;
}
