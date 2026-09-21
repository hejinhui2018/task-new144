// 领域类型定义 —— LineClear 换型放行演练台

/** 证据种类定义 */
export interface EvidenceKindDef {
  id: string
  label: string
  /** 异步证据：先送检、后回执（如实验室尺寸报告、视觉试拍回执） */
  async?: boolean
  required?: boolean
}

/** 可回退参数定义 */
export interface ParameterDef {
  name: string
  /** 候选值，最后一个通常为目标产品（大瓶）值，便于模拟回退 */
  values: string[]
}

/** 步骤模板 */
export interface StepDef {
  id: string
  code: string
  title: string
  stationId: string
  role: string
  /** 前置步骤 id */
  prereq: string[]
  evidenceKinds: EvidenceKindDef[]
  /** 关键放行步骤不允许跳过 */
  critical?: boolean
  skipAllowed?: boolean
  /** 估算工时（分钟），用于关键路径 CPM 计算 */
  durationMin: number
  /** 该步骤承载的可回退工艺参数 */
  parameter?: ParameterDef
}

export interface StationDef {
  id: string
  name: string
  /** 互锁工位：同一时刻只允许一个在执行步骤 */
  exclusive?: boolean
}

export interface ChangeoverTemplate {
  id: string
  name: string
  stations: StationDef[]
  steps: StepDef[]
  frozen: FrozenContext
}

/** 产品版本 */
export interface ProductVersion {
  sku: string
  name: string
  spec: string
}

export interface ConfigItem {
  name: string
  value: string
}

export interface Post {
  role: string
  stationId?: string
  operator: string
}

export interface Standard {
  id: string
  title: string
  version: string
}

/** 开始后冻结的现场基线 */
export interface FrozenContext {
  productFrom: ProductVersion
  productTo: ProductVersion
  line: string
  equipmentConfig: ConfigItem[]
  posts: Post[]
  standards: Standard[]
  frozenAt?: number
}

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped'

export type EvidenceResult = 'pass' | 'fail' | 'info'

/** 证据回执状态：已确认 / 等待异步回执 / 迟到待核对 */
export type ReceiptState = 'confirmed' | 'awaiting' | 'late'

export interface Evidence {
  id: string
  stepId: string
  kindId: string
  label: string
  result: EvidenceResult | 'pending'
  async: boolean
  receipt: ReceiptState
  /** 记录时该步骤所处的代际；步骤被复测/回退后代际递增，旧证据自动失效 */
  gen: number
  recordedAt: number
  recordedBy: string
  /** 派生批次继承自其他批次 */
  inherited?: { fromRunId: string; checkpointId: string }
  /** 回退/复测的失效溯源 */
  invalidatedBy?: string
  reconciled?: 'accepted' | 'rejected'
  reconcileNote?: string
}

export interface StepState {
  id: string
  status: StepStatus
  /** 代际：每次本步骤复测/回退或上游传播失效时 +1 */
  gen: number
  evidenceIds: string[]
  startedAt?: number
  completedAt?: number
  startedBy?: string
  signedBy?: string
  signedAt?: number
  skipReason?: string
  /** 失效原因链：本次失效由哪个步骤的复测/回退引发 */
  invalidatedBy?: string
  /** 当前参数值（可回退步骤） */
  paramValue?: string
  /** 最近一次回退描述 */
  lastRollback?: { fromValue: string; toValue: string; at: number; by: string; reason: string }
  inherited?: boolean
}

export type RunStatus = 'open' | 'running' | 'paused' | 'closed' | 'terminated'

export interface Checkpoint {
  id: string
  label: string
  at: number
  seq: number
}

export interface ReleaseBasisStep {
  code: string
  title: string
  station: string
  status: StepStatus
  signed: boolean
  signedBy?: string
  inherited: boolean
  skipReason?: string
  evidence: { id: string; label: string; result: EvidenceResult | 'pending'; by: string; at: number; inherited: boolean }[]
}

export interface ReleaseBasis {
  runId: string
  closedAt: number
  closedBy: string
  frozen: FrozenContext
  steps: ReleaseBasisStep[]
  lateReceiptsExcluded: number
}

// ---------- 事件 ----------

export type Event =
  | { type: 'RunStarted'; runId: string; templateId: string; at: number; by: string; frozen: FrozenContext; derivedFrom?: { runId: string; checkpointId: string } }
  | { type: 'RunPaused'; at: number; by: string; reason: string }
  | { type: 'RunResumed'; at: number; by: string }
  | { type: 'RunClosed'; at: number; by: string; basis: ReleaseBasis }
  | { type: 'RunTerminated'; at: number; by: string; reason: string }
  | { type: 'StepStarted'; stepId: string; at: number; by: string }
  | { type: 'StepCompleted'; stepId: string; at: number; by: string; gen: number }
  | { type: 'StepSigned'; stepId: string; at: number; by: string; gen: number }
  | { type: 'StepSkipped'; stepId: string; at: number; by: string; reason: string; gen: number }
  | { type: 'StepRetested'; stepId: string; at: number; by: string; reason: string }
  | { type: 'StepRolledBack'; stepId: string; at: number; by: string; reason: string; fromValue: string; toValue: string }
  | { type: 'StepInvalidated'; stepId: string; gen: number; causedBy: string; at: number; reason: string }
  | { type: 'EvidenceRecorded'; evidenceId: string; stepId: string; kindId: string; label: string; result: EvidenceResult | 'pending'; async: boolean; gen: number; at: number; by: string }
  | { type: 'ReceiptDelivered'; evidenceId: string; result: EvidenceResult; at: number }
  | { type: 'InheritedResult'; stepId: string; at: number; fromRunId: string; checkpointId: string; evidence: { kindId: string; label: string; result: EvidenceResult; async: boolean; recordedAt: number; recordedBy: string }[] }
  | { type: 'CheckpointCreated'; checkpointId: string; label: string; at: number; seq: number }
  | { type: 'LateReceiptRecorded'; evidenceId: string; stepId: string; kindId: string; label: string; result: EvidenceResult; at: number; gen: number }
  | { type: 'LateReceiptReconciled'; evidenceId: string; at: number; by: string; accepted: boolean; note: string }

// ---------- 命令 ----------

export type Command =
  | { kind: 'startRun'; runId: string; templateId: string; at: number; by: string }
  | { kind: 'pauseRun'; at: number; by: string; reason: string }  | { kind: 'resumeRun'; at: number; by: string }
  | { kind: 'closeRun'; at: number; by: string }
  | { kind: 'terminateRun'; at: number; by: string; reason: string }
  | { kind: 'startStep'; stepId: string; at: number; by: string }
  | { kind: 'completeStep'; stepId: string; at: number; by: string }
  | { kind: 'signStep'; stepId: string; at: number; by: string }
  | { kind: 'skipStep'; stepId: string; at: number; by: string; reason: string }
  | { kind: 'retestStep'; stepId: string; at: number; by: string; reason: string }
  | { kind: 'rollbackStep'; stepId: string; at: number; by: string; reason: string; toValue: string }
  | { kind: 'recordEvidence'; stepId: string; kindId: string; result: EvidenceResult; at: number; by: string }
  /** 送达异步回执：运行中则更新对应在途证据；已关闭则只进待核对区 */
  | { kind: 'deliverReceipt'; stepId: string; kindId: string; result: EvidenceResult; at: number; by: string }
  | { kind: 'createCheckpoint'; label: string; at: number }
  | {
      kind: 'deriveRun'
      newRunId: string
      sourceRunId: string
      checkpointId: string
      inheritStepIds: string[]
      at: number
      by: string
    }
  | { kind: 'reconcileLateReceipt'; evidenceId: string; accepted: boolean; note: string; at: number; by: string }

export interface Decision {
  ok: boolean
  error?: string
  /** 事件按目标 run 分组，保证一次命令的原子性（撤销/重做的最小单位） */
  entries?: { runId: string; ev: Event }[]
}
