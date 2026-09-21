/** 步骤执行态(派生展示态如"未就绪/就绪"由选择器计算,不落库) */
export type ExecState = 'idle' | 'in_progress' | 'paused' | 'done' | 'skipped';

export type BatchStatus = 'draft' | 'running' | 'interrupted' | 'closed';

export type CloseDecision = 'released' | 'terminated';

/** valid 有效;superseded 已被新一代执行取代(保留不删);late_* 迟到回执 */
export type EvidenceStatus = 'valid' | 'superseded' | 'late_pending' | 'late_accepted' | 'rejected';

export type StepKind = 'normal' | 'checkpoint';

export interface Station {
  id: string;
  name: string;
}

export interface StepTemplate {
  id: string;
  name: string;
  stationId: string;
  deps: string[];
  kind: StepKind;
  requiresEvidence: boolean;
  estimatedMinutes: number;
  description: string;
}

export interface StepState {
  id: string;
  exec: ExecState;
  /** 执行代次:每次被复测/回退失效后 +1,证据按代次判定新旧 */
  generation: number;
  /** 被上游失效的次数 */
  invalidations: number;
  startedAt: number | null;
  completedAt: number | null;
  pauseReason: string | null;
  skipReason: string | null;
  signedBy: string | null;
  signedAt: number | null;
  /** 派生批次中标记结果继承自哪个批次 */
  inheritedFrom: string | null;
}

export interface Evidence {
  id: string;
  batchId: string;
  stepId: string;
  generation: number;
  title: string;
  value: string;
  submittedBy: string;
  at: number;
  status: EvidenceStatus;
  inheritedFromBatch: string | null;
  reviewNote: string | null;
}

export type EventKind = 'batch' | 'step' | 'evidence' | 'release' | 'derive' | 'review';

export interface LogEvent {
  seq: number;
  at: number;
  batchId: string;
  kind: EventKind;
  message: string;
}

export interface PostAssignment {
  postId: string;
  postName: string;
  operator: string;
}

/** 启动批次时冻结的基线,执行期间不可更改 */
export interface FrozenContext {
  productVersion: string;
  equipmentConfig: string;
  inspectionStandard: string;
  posts: PostAssignment[];
  frozenAt: number;
}

export interface ReleaseBasis {
  doneSteps: string[];
  skippedSteps: string[];
  validEvidence: number;
  supersededEvidence: number;
  signoffs: { stepId: string; signedBy: string }[];
}

export interface ReleaseRecord {
  decision: CloseDecision;
  reason: string;
  operator: string;
  at: number;
  basis: ReleaseBasis;
}

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  closeDecision: CloseDecision | null;
  closeReason: string | null;
  template: StepTemplate[];
  stations: Station[];
  steps: Record<string, StepState>;
  frozen: FrozenContext | null;
  evidence: Evidence[];
  events: LogEvent[];
  derivedFrom: { batchId: string; checkpointStepId: string } | null;
  release: ReleaseRecord | null;
  createdAt: number;
  startedAt: number | null;
  closedAt: number | null;
}

export interface AppState {
  version: 1;
  batches: Record<string, Batch>;
  batchOrder: string[];
  /** 待核对区:批次关闭后到达的迟到回执 */
  lateInbox: Evidence[];
  /** 逻辑时钟,每条被应用的指令 +1,作为时间戳 */
  clock: number;
  eventSeq: number;
  batchSeq: number;
  evSeq: number;
  /** 幂等键:已应用指令 id,重复提交直接忽略 */
  appliedCommandIds: string[];
}

export type Command =
  | { id: string; type: 'CREATE_BATCH'; name: string; template?: StepTemplate[]; stations?: Station[] }
  | { id: string; type: 'START_BATCH'; batchId: string; frozen: Omit<FrozenContext, 'frozenAt'> }
  | { id: string; type: 'START_STEP'; batchId: string; stepId: string; operator: string }
  | { id: string; type: 'PAUSE_STEP'; batchId: string; stepId: string; reason: string }
  | { id: string; type: 'RESUME_STEP'; batchId: string; stepId: string }
  | { id: string; type: 'COMPLETE_STEP'; batchId: string; stepId: string; operator: string; evidence?: { title: string; value: string } }
  | { id: string; type: 'SKIP_STEP'; batchId: string; stepId: string; reason: string; operator: string }
  | { id: string; type: 'RETEST_STEP'; batchId: string; stepId: string; reason: string; operator: string }
  | { id: string; type: 'ROLLBACK_STEP'; batchId: string; stepId: string; reason: string; operator: string }
  | { id: string; type: 'SIGN_OFF'; batchId: string; stepId: string; signer: string }
  | { id: string; type: 'SUBMIT_EVIDENCE'; batchId: string; stepId: string; title: string; value: string; submittedBy: string; forGeneration?: number }
  | { id: string; type: 'INTERRUPT_BATCH'; batchId: string; reason: string }
  | { id: string; type: 'RESUME_BATCH'; batchId: string }
  | { id: string; type: 'CLOSE_BATCH'; batchId: string; decision: CloseDecision; reason: string; operator: string }
  | { id: string; type: 'DERIVE_BATCH'; sourceBatchId: string; checkpointStepId: string; inheritStepIds: string[]; name: string }
  | { id: string; type: 'REVIEW_LATE_EVIDENCE'; evidenceId: string; accept: boolean; note: string; reviewer: string };
