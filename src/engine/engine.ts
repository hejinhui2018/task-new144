import type {
  ChangeoverTemplate,
  Checkpoint,
  Command,
  Decision,
  Event,
  Evidence,
  ReleaseBasis,
  RunStatus,
  StepDef,
  StepState,
} from './types'
import { getTemplate } from './template'

// ---------- 运行态 ----------

export interface RunState {
  id: string
  templateId: string
  status: RunStatus
  frozenAt?: number
  frozen?: ChangeoverTemplate['frozen']
  derivedFrom?: { runId: string; checkpointId: string }
  steps: Record<string, StepState>
  /** 证据按 id 存放（含已失效与迟到证据，永不物理删除） */
  evidences: Record<string, Evidence>
  evidenceOrder: string[]
  checkpoints: Checkpoint[]
  closedBasis?: ReleaseBasis
  createdAt?: number
  createdBy?: string
  terminatedReason?: string
  pauseReason?: string
}

export type World = Record<string, RunState>

export function emptyWorld(): World {
  return {}
}

function initialSteps(tpl: ChangeoverTemplate): Record<string, StepState> {
  const steps: Record<string, StepState> = {}
  for (const s of tpl.steps) {
    steps[s.id] = { id: s.id, status: 'pending', gen: 0, evidenceIds: [] }
    // 参数初值取候选值首项（模板中首项为目标产品值）
    if (s.parameter) steps[s.id].paramValue = s.parameter.values[0]
  }
  return steps
}

// ---------- 图计算 ----------

export function stepMap(tpl: ChangeoverTemplate): Map<string, StepDef> {
  return new Map(tpl.steps.map((s) => [s.id, s]))
}

/** 传递下游闭包（不含自身），按拓扑序返回 */
export function dependents(tpl: ChangeoverTemplate, rootId: string): string[] {
  const reverse = new Map<string, Set<string>>()
  for (const s of tpl.steps) for (const p of s.prereq) {
    if (!reverse.has(p)) reverse.set(p, new Set())
    reverse.get(p)!.add(s.id)
  }
  const out: string[] = []
  const seen = new Set<string>([rootId])
  let frontier = [rootId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const d of reverse.get(id) ?? []) {
        if (!seen.has(d)) {
          seen.add(d)
          out.push(d)
          next.push(d)
        }
      }
    }
    frontier = next
  }
  return out
}

/**
 * 关键路径 CPM：以估算工时为权重求最早/最晚开始时间，
 * 零松弛（slack=0）的步骤构成关键路径。
 */
export function criticalPath(tpl: ChangeoverTemplate): Set<string> {
  const defs = stepMap(tpl)
  const topo = topoSort(tpl)
  // EF：最早完成；ES = max(EF 前置)
  const ef = new Map<string, number>()
  for (const id of topo) {
    const s = defs.get(id)!
    const es = s.prereq.length ? Math.max(...s.prereq.map((p) => ef.get(p)!)) : 0
    ef.set(id, es + s.durationMin)
  }
  const projectEnd = Math.max(...topo.map((id) => ef.get(id)!))
  // LF：最晚开始不影响工期
  const ls = new Map<string, number>()
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i]
    const successors = tpl.steps.filter((s) => s.prereq.includes(id))
    ls.set(id, successors.length ? Math.min(...successors.map((d) => ls.get(d.id)!)) - defs.get(id)!.durationMin : projectEnd - defs.get(id)!.durationMin)
  }
  const critical = new Set<string>()
  for (const id of topo) {
    const es = defs.get(id)!.prereq.length ? Math.max(...defs.get(id)!.prereq.map((p) => ef.get(p)!)) : 0
    if (ls.get(id)! === es) critical.add(id)
  }
  return critical
}

export function topoSort(tpl: ChangeoverTemplate): string[] {
  const defs = stepMap(tpl)
  const visited = new Set<string>()
  const out: string[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    const s = defs.get(id)
    if (!s) throw new Error(`缺少步骤定义：${id}`)
    for (const p of s.prereq) visit(p)
    visited.add(id)
    out.push(id)
  }
  for (const s of tpl.steps) visit(s.id)
  return out
}

// ---------- 证据选择器 ----------

export function effectiveEvidence(run: RunState, stepId: string): Evidence[] {
  const st = run.steps[stepId]
  if (!st) return []
  return st.evidenceIds
    .map((id) => run.evidences[id])
    .filter((e) => e.gen === st.gen && e.receipt === 'confirmed' && e.reconciled !== 'rejected')
}

export function awaitingEvidence(run: RunState, stepId: string): Evidence[] {
  const st = run.steps[stepId]
  if (!st) return []
  return st.evidenceIds
    .map((id) => run.evidences[id])
    .filter((e) => e.gen === st.gen && e.receipt === 'awaiting')
}

/** 失效但保留的旧证据（前一次换线/上一代际残留，以及迟到回执） */
export function staleEvidence(run: RunState, stepId: string): Evidence[] {
  const st = run.steps[stepId]
  if (!st) return []
  return st.evidenceIds
    .map((id) => run.evidences[id])
    .filter((e) => e.receipt === 'late' || e.gen !== st.gen)
}

export function allLateReceipts(run: RunState): Evidence[] {
  return run.evidenceOrder.map((id) => run.evidences[id]).filter((e) => e.receipt === 'late')
}

// ---------- 门禁 ----------

export type GateIssue =
  | { kind: 'prereq'; stepId: string; code: string; title: string; state: StepState['status'] }
  | { kind: 'station'; stationName: string; occupantStepId: string; code: string; title: string }
  | { kind: 'evidence-missing'; label: string }
  | { kind: 'evidence-awaiting'; label: string; evidenceId: string }
  | { kind: 'evidence-fail'; evidenceId: string; label: string }
  | { kind: 'not-started' }
  | { kind: 'unsigned' }
  | { kind: 'in-progress' }
  | { kind: 'skipped'; code: string; title: string }
  | { kind: 'critical-skip' }
  | { kind: 'late-pending'; evidenceId: string; label: string }

/** 步骤“开始”门禁：前置完成（跳过可放行）+ 互锁工位空闲 */
export function startGate(tpl: ChangeoverTemplate, run: RunState, stepId: string): GateIssue[] {
  const defs = stepMap(tpl)
  const issues: GateIssue[] = []
  const s = defs.get(stepId)!
  for (const p of s.prereq) {
    const ps = run.steps[p]
    if (!ps || (ps.status !== 'done' && ps.status !== 'skipped')) {
      const pd = defs.get(p)!
      issues.push({ kind: 'prereq', stepId: p, code: pd.code, title: pd.title, state: ps?.status ?? 'pending' })
    }
  }
  const station = tpl.stations.find((x) => x.id === s.stationId)
  if (station?.exclusive) {
    for (const other of tpl.steps) {
      if (other.id === stepId || other.stationId !== station.id) continue
      if (run.steps[other.id]?.status === 'in_progress') {
        issues.push({ kind: 'station', stationName: station.name, occupantStepId: other.id, code: other.code, title: other.title })
      }
    }
  }
  return issues
}

/** 步骤“完成”门禁：必备证据当前代际已确认、全部 pass，无在途回执 */
export function completeGate(tpl: ChangeoverTemplate, run: RunState, stepId: string): GateIssue[] {
  const defs = stepMap(tpl)
  const s = defs.get(stepId)!
  const issues: GateIssue[] = startGate(tpl, run, stepId)
  const st = run.steps[stepId]
  if (st.status !== 'in_progress') issues.push({ kind: 'not-started' })
  const eff = effectiveEvidence(run, stepId)
  const awaiting = awaitingEvidence(run, stepId)
  for (const k of s.evidenceKinds) {
    if (!k.required) continue
    const pending = awaiting.filter((e) => e.kindId === k.id)
    const confirmed = eff.filter((e) => e.kindId === k.id)
    if (confirmed.some((e) => e.result === 'fail')) {
      issues.push({ kind: 'evidence-fail', evidenceId: confirmed.find((e) => e.result === 'fail')!.id, label: k.label })
    } else if (pending.length) {
      issues.push({ kind: 'evidence-awaiting', label: k.label, evidenceId: pending[0].id })
    } else if (!confirmed.some((e) => e.result === 'pass')) {
      // 仅有 info 中性记录不满足必备项，必须有合格结论
      issues.push({ kind: 'evidence-missing', label: k.label })
    }
  }
  return dedupeIssues(issues)
}

/** 整线“放行关闭”门禁。迟到回执不阻断放行（已被排除在依据之外），仅提示待核对。 */
export function releaseGate(tpl: ChangeoverTemplate, run: RunState): GateIssue[] {
  const issues: GateIssue[] = []
  for (const s of tpl.steps) {
    const st = run.steps[s.id]
    if (st.status === 'pending') {
      issues.push({ kind: 'prereq', stepId: s.id, code: s.code, title: s.title, state: 'pending' })
    } else if (st.status === 'in_progress') {
      issues.push({ kind: 'in-progress' })
    } else if (st.status === 'done' && !st.signedBy) {
      issues.push({ kind: 'unsigned' })
    } else if (st.status === 'skipped' && s.critical) {
      issues.push({ kind: 'critical-skip' })
    }
  }
  return dedupeIssues(issues)
}

function dedupeIssues(issues: GateIssue[]): GateIssue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const key = JSON.stringify(i)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatGate(g: GateIssue): string {
  switch (g.kind) {
    case 'prereq':
      return `前置 ${g.code}《${g.title}》尚未完成（当前：${statusText(g.state)}）`
    case 'station':
      return `工位互锁：${g.code}《${g.title}》正在占用${g.stationName}`
    case 'evidence-missing':
      return `缺少必备证据：${g.label}`
    case 'evidence-awaiting':
      return `等待异步检测回执：${g.label}`
    case 'evidence-fail':
      return `证据不合格：${g.label}（须复测）`
    case 'not-started':
      return '步骤尚未开始'
    case 'unsigned':
      return '存在已完成但未签收的步骤'
    case 'in-progress':
      return '存在执行中的步骤'
    case 'skipped':
      return `步骤 ${g.code}《${g.title}》已跳过`
    case 'critical-skip':
      return '关键放行步骤被跳过'
    case 'late-pending':
      return `存在未核对的迟到回执：${g.label}`
    default:
      return '放行条件未满足'
  }
}

function statusText(s: StepState['status']): string {
  return { pending: '未开始', in_progress: '执行中', done: '已完成', skipped: '已跳过' }[s]
}

// ---------- 命令决策 ----------

export interface EngineContext {
  newId: (prefix: string) => string
  /** 下一个全局事件序号 */
  nextSeq: number
  /** 重放指定批次在某全局序号（含）之前的状态，用于检查点派生 */
  replayUntil: (runId: string, untilSeq: number) => RunState | undefined
}

function reject(error: string): Decision {
  return { ok: false, error }
}

function accept(...entries: { runId: string; ev: Event }[]): Decision {
  return { ok: true, entries }
}

function activeRun(world: World): RunState | undefined {
  return Object.values(world).find((r) => r.status === 'running' || r.status === 'paused')
}

/**
 * 定位步骤所属批次：优先活动批次；否则取最近创建的批次，
 * 以便对已关闭/终止批次的误操作给出准确的拒绝原因（而非“批次不存在”）。
 */
function targetRun(world: World, stepId: string): RunState | undefined {
  const active = activeRun(world)
  if (active?.steps[stepId]) return active
  return Object.values(world)
    .filter((r) => r.steps[stepId])
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
}

function requireExecuting(run: RunState | undefined): string | null {
  if (!run) return '没有运行中的批次'
  if (run.status === 'closed') return '批次已关闭放行，不能再执行操作'
  if (run.status === 'terminated') return '批次已提前终止'
  if (run.status === 'paused') return '批次已暂停，请先恢复再操作'
  return null
}

export function decide(cmd: Command, world: World, ctx: EngineContext): Decision {
  switch (cmd.kind) {
    case 'startRun': {
      if (world[cmd.runId]) return reject('批次已存在，禁止重复开始')
      if (activeRun(world)) return reject('已有进行中的批次，请先关闭或终止')
      const tpl = getTemplate(cmd.templateId)
      const frozen = { ...structuredClone(tpl.frozen), frozenAt: cmd.at }
      return accept({
        runId: cmd.runId,
        ev: { type: 'RunStarted', runId: cmd.runId, templateId: cmd.templateId, at: cmd.at, by: cmd.by, frozen },
      })
    }

    case 'pauseRun': {
      const run = activeRun(world)
      if (!run) return reject('没有运行中的批次')
      if (run.status !== 'running') return reject(`当前状态为 ${run.status}，不能暂停`)
      if (!cmd.reason.trim()) return reject('暂停需要填写原因')
      return accept({ runId: run.id, ev: { type: 'RunPaused', at: cmd.at, by: cmd.by, reason: cmd.reason } })
    }

    case 'resumeRun': {
      const run = Object.values(world).find((r) => r.status === 'paused')
      if (!run) return reject('没有已暂停的批次')
      return accept({ runId: run.id, ev: { type: 'RunResumed', at: cmd.at, by: cmd.by } })
    }

    case 'terminateRun': {
      const run = activeRun(world)
      if (!run) return reject('没有可终止的运行中批次')
      if (!cmd.reason.trim()) return reject('提前终止必须填写原因')
      return accept({ runId: run.id, ev: { type: 'RunTerminated', at: cmd.at, by: cmd.by, reason: cmd.reason } })
    }

    case 'startStep': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      const st = run!.steps[cmd.stepId]
      if (st.status === 'done') return reject(`${def.code} 已完成；如需重做请使用“复测”`)
      if (st.status === 'in_progress') return reject(`${def.code} 已在执行中，禁止重复开始`)
      if (st.status === 'skipped') return reject(`${def.code} 已跳过`)
      const gates = startGate(tpl, run!, cmd.stepId)
      if (gates.length) return reject(formatGate(gates[0]))
      return accept({ runId: run!.id, ev: { type: 'StepStarted', stepId: cmd.stepId, at: cmd.at, by: cmd.by } })
    }

    case 'recordEvidence': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      const kind = def.evidenceKinds.find((k) => k.id === cmd.kindId)
      if (!kind) return reject('该步骤未定义此检查项')
      const st = run!.steps[cmd.stepId]
      if (st.status !== 'in_progress') return reject(`${def.code} 未在执行中，不能记录证据（防止把前一次换线的证据计入本批）`)
      const eid = ctx.newId('ev')
      return accept({
        runId: run!.id,
        ev: {
          type: 'EvidenceRecorded',
          evidenceId: eid,
          stepId: cmd.stepId,
          kindId: cmd.kindId,
          label: kind.label,
          result: kind.async ? 'pending' : cmd.result,
          async: !!kind.async,
          gen: st.gen,
          at: cmd.at,
          by: cmd.by,
        },
      })
    }

    case 'deliverReceipt': {
      const located = Object.values(world).find((r) => r.steps[cmd.stepId])
      if (!located) return reject('步骤不存在')
      const tpl = getTemplate(located.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)!
      const kind = def.evidenceKinds.find((k) => k.id === cmd.kindId)
      if (!kind?.async) return reject('该检查项不是异步检测，没有回执')
      const st = located.steps[cmd.stepId]
      const toLate = (evidenceId: string): Decision =>
        accept({
          runId: located.id,
          ev: { type: 'LateReceiptRecorded', evidenceId, stepId: cmd.stepId, kindId: cmd.kindId, label: kind.label, result: cmd.result, at: cmd.at, gen: st.gen },
        })
      // 已关闭/终止：迟到回执一律只进待核对区，绝不覆盖当班结论
      if (located.status === 'closed' || located.status === 'terminated') {
        const old = st.evidenceIds.map((id) => located.evidences[id]).find((e) => e.kindId === cmd.kindId && e.receipt === 'awaiting')
        return toLate(old?.id ?? ctx.newId('ev'))
      }
      if (located.status !== 'running') return reject('批次未在运行')
      // 仅“当前代际 + 在途”的回执才能确认进当班结论
      const current = st.evidenceIds
        .map((id) => located.evidences[id])
        .find((e) => e.kindId === cmd.kindId && e.receipt === 'awaiting' && e.gen === st.gen)
      if (current) {
        return accept({ runId: located.id, ev: { type: 'ReceiptDelivered', evidenceId: current.id, result: cmd.result, at: cmd.at } })
      }
      // 代际已失效（步骤经历过复测/回退）：回执迟到，进待核对区
      const staleAwaiting = st.evidenceIds
        .map((id) => located.evidences[id])
        .find((e) => e.kindId === cmd.kindId && e.receipt === 'awaiting')
      return toLate(staleAwaiting?.id ?? ctx.newId('ev'))
    }

    case 'completeStep': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      const st = run!.steps[cmd.stepId]
      if (st.status === 'done') return reject(`${def.code} 已完成，禁止重复完成`)
      if (st.status === 'skipped') return reject(`${def.code} 已跳过`)
      if (st.status === 'pending') return reject(`${def.code} 尚未开始`)
      const gates = completeGate(tpl, run!, cmd.stepId)
      if (gates.length) return reject(formatGate(gates[0]))
      return accept({ runId: run!.id, ev: { type: 'StepCompleted', stepId: cmd.stepId, at: cmd.at, by: cmd.by, gen: st.gen } })
    }

    case 'signStep': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      const st = run!.steps[cmd.stepId]
      if (st.status !== 'done') return reject(`${def.code} 未完成，不能签收`)
      if (st.signedBy) return reject(`${def.code} 已由 ${st.signedBy} 签收，禁止重复签收`)
      return accept({ runId: run!.id, ev: { type: 'StepSigned', stepId: cmd.stepId, at: cmd.at, by: cmd.by, gen: st.gen } })
    }

    case 'skipStep': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      if (def.critical) return reject(`${def.code} 是关键放行步骤，不允许跳过`)
      const st = run!.steps[cmd.stepId]
      if (st.status !== 'pending') return reject(`${def.code} 当前状态不能跳过（仅未开始步骤可跳过）`)
      if (!cmd.reason.trim()) return reject('跳过必须填写原因')
      return accept({
        runId: run!.id,
        ev: { type: 'StepSkipped', stepId: cmd.stepId, at: cmd.at, by: cmd.by, reason: cmd.reason, gen: st.gen + 1 },
      })
    }

    case 'retestStep':
    case 'rollbackStep': {
      const run = targetRun(world, cmd.stepId)
      const err = requireExecuting(run)
      if (err) return reject(err)
      const tpl = getTemplate(run!.templateId)
      const def = tpl.steps.find((s) => s.id === cmd.stepId)
      if (!def) return reject('步骤不存在')
      const st = run!.steps[cmd.stepId]
      const verb = cmd.kind === 'retestStep' ? '复测' : '回退'
      if (st.status === 'pending') return reject(`${def.code} 尚未执行，无需${verb}`)
      if (cmd.kind === 'rollbackStep' && st.status === 'skipped') return reject(`${def.code} 已跳过，不能回退参数`)
      if (!cmd.reason.trim()) return reject(`必须填写${verb}原因，留下可追溯记录`)

      const entries: { runId: string; ev: Event }[] = []
      if (cmd.kind === 'rollbackStep') {
        if (!def.parameter) return reject(`${def.code} 没有可回退的工艺参数`)
        if (!def.parameter.values.includes(cmd.toValue)) return reject('回退目标值不在允许的参数候选中')
        if (cmd.toValue === st.paramValue) return reject('回退目标值与当前值相同，属于重复操作')
        entries.push({
          runId: run!.id,
          ev: {
            type: 'StepRolledBack',
            stepId: cmd.stepId,
            at: cmd.at,
            by: cmd.by,
            reason: cmd.reason,
            fromValue: st.paramValue ?? def.parameter.values[0],
            toValue: cmd.toValue,
          },
        })
      } else {
        entries.push({ runId: run!.id, ev: { type: 'StepRetested', stepId: cmd.stepId, at: cmd.at, by: cmd.by, reason: cmd.reason } })
      }
      // 依赖传播：已开始/完成/跳过的下游步骤一律失效（pending 无需处理）；旧证据保留
      for (const d of dependents(tpl, cmd.stepId)) {
        const ds = run!.steps[d]
        if (ds.status !== 'pending') {
          const dd = tpl.steps.find((x) => x.id === d)!
          entries.push({
            runId: run!.id,
            ev: {
              type: 'StepInvalidated',
              stepId: d,
              gen: ds.gen + 1,
              causedBy: cmd.stepId,
              at: cmd.at,
              reason: `${def.code} ${verb}，${dd.code} 依赖的前提发生变化，既有结果失效须重做`,
            },
          })
        }
      }
      return accept(...entries)
    }

    case 'createCheckpoint': {
      const run = activeRun(world)
      if (!run) return reject('没有运行中的批次，无法建立检查点')
      if (!cmd.label.trim()) return reject('检查点需要名称')
      return accept({
        runId: run.id,
        ev: { type: 'CheckpointCreated', checkpointId: ctx.newId('cp'), label: cmd.label, at: cmd.at, seq: ctx.nextSeq },
      })
    }

    case 'deriveRun': {
      const source = world[cmd.sourceRunId]
      if (!source) return reject('源批次不存在')
      if (world[cmd.newRunId]) return reject('新批次已存在，禁止重复创建')
      if (activeRun(world)) return reject('另有进行中的批次，请先关闭或终止后再派生新批次')
      const cp = source.checkpoints.find((c) => c.id === cmd.checkpointId)
      if (!cp) return reject('检查点不存在')
      const snapshot = ctx.replayUntil(cmd.sourceRunId, cp.seq)
      if (!snapshot) return reject('无法复原检查点时刻的状态')
      const tpl = getTemplate(source.templateId)
      for (const stepId of cmd.inheritStepIds) {
        const def = tpl.steps.find((s) => s.id === stepId)
        if (!def) return reject(`继承失败：步骤 ${stepId} 不存在`)
        const snap = snapshot.steps[stepId]
        if (!snap || snap.status !== 'done' || !snap.signedBy) {
          return reject(`继承失败：${def.code} 在检查点时刻未完成或未签收，不能继承`)
        }
        if (!effectiveEvidence(snapshot, stepId).length) return reject(`继承失败：${def.code} 在检查点时刻没有有效证据`)
      }
      const frozen = { ...structuredClone(source.frozen!), frozenAt: cmd.at }
      const entries: { runId: string; ev: Event }[] = [
        {
          runId: cmd.newRunId,
          ev: {
            type: 'RunStarted',
            runId: cmd.newRunId,
            templateId: source.templateId,
            at: cmd.at,
            by: cmd.by,
            frozen,
            derivedFrom: { runId: cmd.sourceRunId, checkpointId: cmd.checkpointId },
          },
        },
      ]
      for (const stepId of cmd.inheritStepIds) {
        const evs = effectiveEvidence(snapshot, stepId).map((e) => ({
          kindId: e.kindId,
          label: e.label,
          result: e.result as 'pass' | 'fail' | 'info',
          async: false,
          recordedAt: e.recordedAt,
          recordedBy: e.recordedBy,
        }))
        entries.push({
          runId: cmd.newRunId,
          ev: { type: 'InheritedResult', stepId, at: cmd.at, fromRunId: cmd.sourceRunId, checkpointId: cmd.checkpointId, evidence: evs },
        })
      }
      return accept(...entries)
    }

    case 'reconcileLateReceipt': {
      const run = Object.values(world).find((r) => r.evidenceOrder.includes(cmd.evidenceId))
      if (!run) return reject('回执不存在')
      const ev = run.evidences[cmd.evidenceId]
      if (ev.receipt !== 'late') return reject('该证据不是待核对的迟到回执')
      if (ev.reconciled) return reject('该回执已核对，禁止重复操作')
      return accept({
        runId: run.id,
        ev: { type: 'LateReceiptReconciled', evidenceId: cmd.evidenceId, at: cmd.at, by: cmd.by, accepted: cmd.accepted, note: cmd.note },
      })
    }

    case 'closeRun': {
      const run = activeRun(world)
      if (!run) return reject('没有运行中的批次')
      if (run.status !== 'running') return reject(`批次状态为 ${run.status}，不能放行关闭`)
      const tpl = getTemplate(run.templateId)
      const blockers = releaseGate(tpl, run)
      if (blockers.length) return reject('放行条件未满足：' + blockers.map(formatGate).join('；'))
      const basis = buildReleaseBasis(tpl, run, cmd.at, cmd.by)
      return accept({ runId: run.id, ev: { type: 'RunClosed', at: cmd.at, by: cmd.by, basis } })
    }

    default:
      return reject('未知命令')
  }
}

// ---------- 放行依据快照 ----------

export function buildReleaseBasis(tpl: ChangeoverTemplate, run: RunState, at: number, by: string): ReleaseBasis {
  return {
    runId: run.id,
    closedAt: at,
    closedBy: by,
    frozen: structuredClone(run.frozen!),
    steps: tpl.steps.map((s) => {
      const st = run.steps[s.id]
      return {
        code: s.code,
        title: s.title,
        station: tpl.stations.find((x) => x.id === s.stationId)!.name,
        status: st.status,
        signed: !!st.signedBy,
        signedBy: st.signedBy,
        inherited: !!st.inherited,
        skipReason: st.skipReason,
        evidence: effectiveEvidence(run, s.id).map((e) => ({
          id: e.id,
          label: e.label,
          result: e.result,
          by: e.recordedBy,
          at: e.recordedAt,
          inherited: !!e.inherited,
        })),
      }
    }),
    lateReceiptsExcluded: allLateReceipts(run).length,
  }
}

// ---------- 事件归约 ----------

export function applyEvent(run: RunState | undefined, ev: Event): RunState {
  switch (ev.type) {
    case 'RunStarted': {
      const tpl = getTemplate(ev.templateId)
      return {
        id: ev.runId,
        templateId: ev.templateId,
        status: 'running',
        frozenAt: ev.at,
        frozen: ev.frozen,
        derivedFrom: ev.derivedFrom,
        steps: initialSteps(tpl),
        evidences: {},
        evidenceOrder: [],
        checkpoints: [],
        createdAt: ev.at,
        createdBy: ev.by,
      }
    }
    case 'RunPaused':
      return { ...run!, status: 'paused', pauseReason: ev.reason }
    case 'RunResumed':
      return { ...run!, status: 'running', pauseReason: undefined }
    case 'RunTerminated':
      return { ...run!, status: 'terminated', terminatedReason: ev.reason }
    case 'RunClosed':
      return { ...run!, status: 'closed', closedBasis: ev.basis }
    case 'StepStarted': {
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        steps: { ...run!.steps, [ev.stepId]: { ...st, status: 'in_progress', startedAt: ev.at, startedBy: ev.by } },
      }
    }
    case 'StepCompleted': {
      const st = run!.steps[ev.stepId]
      return { ...run!, steps: { ...run!.steps, [ev.stepId]: { ...st, status: 'done', completedAt: ev.at } } }
    }
    case 'StepSigned': {
      const st = run!.steps[ev.stepId]
      return { ...run!, steps: { ...run!.steps, [ev.stepId]: { ...st, signedBy: ev.by, signedAt: ev.at } } }
    }
    case 'StepSkipped': {
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        steps: { ...run!.steps, [ev.stepId]: { ...resetExecution(st), status: 'skipped', gen: ev.gen, skipReason: ev.reason } },
      }
    }
    case 'StepRetested': {
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        steps: {
          ...run!.steps,
          [ev.stepId]: {
            ...resetExecution(st),
            status: 'in_progress',
            gen: st.gen + 1,
            startedAt: ev.at,
            startedBy: ev.by,
            invalidatedBy: 'self-retest',
          },
        },
      }
    }
    case 'StepRolledBack': {
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        steps: {
          ...run!.steps,
          [ev.stepId]: {
            ...resetExecution(st),
            status: 'in_progress',
            gen: st.gen + 1,
            startedAt: ev.at,
            startedBy: ev.by,
            paramValue: ev.toValue,
            lastRollback: { fromValue: ev.fromValue, toValue: ev.toValue, at: ev.at, by: ev.by, reason: ev.reason },
            invalidatedBy: 'self-rollback',
          },
        },
      }
    }
    case 'StepInvalidated': {
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        steps: { ...run!.steps, [ev.stepId]: { ...resetExecution(st), status: 'pending', gen: ev.gen, invalidatedBy: ev.causedBy } },
      }
    }
    case 'EvidenceRecorded': {
      const evidence: Evidence = {
        id: ev.evidenceId,
        stepId: ev.stepId,
        kindId: ev.kindId,
        label: ev.label,
        result: ev.result,
        async: ev.async,
        receipt: ev.async ? 'awaiting' : 'confirmed',
        gen: ev.gen,
        recordedAt: ev.at,
        recordedBy: ev.by,
      }
      const st = run!.steps[ev.stepId]
      return {
        ...run!,
        evidences: { ...run!.evidences, [ev.evidenceId]: evidence },
        evidenceOrder: [...run!.evidenceOrder, ev.evidenceId],
        steps: { ...run!.steps, [ev.stepId]: { ...st, evidenceIds: [...st.evidenceIds, ev.evidenceId] } },
      }
    }
    case 'ReceiptDelivered': {
      const old = run!.evidences[ev.evidenceId]
      return { ...run!, evidences: { ...run!.evidences, [ev.evidenceId]: { ...old, receipt: 'confirmed', result: ev.result } } }
    }
    case 'LateReceiptRecorded': {
      const existing = run!.evidences[ev.evidenceId]
      const evidence: Evidence = existing
        ? { ...existing, receipt: 'late', result: ev.result, reconciled: undefined, reconcileNote: undefined }
        : {
            id: ev.evidenceId,
            stepId: ev.stepId,
            kindId: ev.kindId,
            label: ev.label,
            result: ev.result,
            async: true,
            receipt: 'late',
            gen: ev.gen,
            recordedAt: ev.at,
            recordedBy: '检测方（迟到）',
          }
      const evidenceOrder = existing ? run!.evidenceOrder : [...run!.evidenceOrder, ev.evidenceId]
      const steps = existing
        ? run!.steps
        : {
            ...run!.steps,
            [ev.stepId]: { ...run!.steps[ev.stepId], evidenceIds: [...run!.steps[ev.stepId].evidenceIds, ev.evidenceId] },
          }
      return { ...run!, evidences: { ...run!.evidences, [ev.evidenceId]: evidence }, evidenceOrder, steps }
    }
    case 'LateReceiptReconciled': {
      const old = run!.evidences[ev.evidenceId]
      return {
        ...run!,
        evidences: {
          ...run!.evidences,
          [ev.evidenceId]: { ...old, reconciled: ev.accepted ? 'accepted' : 'rejected', reconcileNote: ev.note },
        },
      }
    }
    case 'InheritedResult': {
      const st = run!.steps[ev.stepId]
      const newEv: Evidence[] = ev.evidence.map((e, i) => ({
        id: `inh-${ev.stepId}-${i}-${ev.at}`,
        stepId: ev.stepId,
        kindId: e.kindId,
        label: e.label,
        result: e.result,
        async: false,
        receipt: 'confirmed',
        gen: st.gen,
        recordedAt: e.recordedAt,
        recordedBy: e.recordedBy,
        inherited: { fromRunId: ev.fromRunId, checkpointId: ev.checkpointId },
      }))
      const evidences = { ...run!.evidences }
      for (const e of newEv) evidences[e.id] = e
      return {
        ...run!,
        evidences,
        evidenceOrder: [...run!.evidenceOrder, ...newEv.map((e) => e.id)],
        steps: {
          ...run!.steps,
          [ev.stepId]: {
            ...st,
            status: 'done',
            completedAt: ev.at,
            signedBy: `继承自 ${ev.fromRunId} 检查点`,
            signedAt: ev.at,
            inherited: true,
            evidenceIds: [...st.evidenceIds, ...newEv.map((e) => e.id)],
          },
        },
      }
    }
    case 'CheckpointCreated':
      return { ...run!, checkpoints: [...run!.checkpoints, { id: ev.checkpointId, label: ev.label, at: ev.at, seq: ev.seq }] }
    default:
      return run!
  }
}

function resetExecution(st: StepState): StepState {
  return {
    ...st,
    startedAt: undefined,
    startedBy: undefined,
    completedAt: undefined,
    signedBy: undefined,
    signedAt: undefined,
    skipReason: undefined,
    inherited: false,
  }
}

// ---------- 日志归约 ----------

export function foldEntries(world: World, entries: { runId: string; ev: Event }[]): World {
  let next = world
  for (const { runId, ev } of entries) {
    next = { ...next, [runId]: applyEvent(next[runId], ev) }
  }
  return next
}

export function foldWorld(entries: { runId: string; ev: Event }[]): World {
  return foldEntries(emptyWorld(), entries)
}

// ---------- 工位状态 / 阻塞原因（UI 用） ----------

export interface StationView {
  id: string
  name: string
  exclusive: boolean
  occupant?: { stepId: string; code: string; title: string }
  blockedStepIds: string[]
}

export function stationViews(tpl: ChangeoverTemplate, run: RunState): StationView[] {
  return tpl.stations.map((station) => {
    const stepsHere = tpl.steps.filter((s) => s.stationId === station.id)
    const occupantStep = stepsHere.find((s) => run.steps[s.id]?.status === 'in_progress')
    return {
      id: station.id,
      name: station.name,
      exclusive: !!station.exclusive,
      occupant: occupantStep ? { stepId: occupantStep.id, code: occupantStep.code, title: occupantStep.title } : undefined,
      blockedStepIds: station.exclusive && occupantStep ? stepsHere.filter((s) => s.id !== occupantStep.id).map((s) => s.id) : [],
    }
  })
}

/** 每个步骤当前“最主要的阻塞原因”，供页面红色提示 */
export function stepBlockers(tpl: ChangeoverTemplate, run: RunState): Record<string, GateIssue[]> {
  const out: Record<string, GateIssue[]> = {}
  for (const s of tpl.steps) {
    const st = run.steps[s.id]
    if (st.status === 'done' || st.status === 'skipped') {
      out[s.id] = []
      continue
    }
    out[s.id] = st.status === 'in_progress'
      ? completeGate(tpl, run, s.id).filter((g) =>
          ['evidence-missing', 'evidence-awaiting', 'evidence-fail'].includes(g.kind))
      : startGate(tpl, run, s.id)
  }
  return out
}

// ---------- 批次对比 ----------

export interface RunComparison {
  templateId: string
  steps: {
    code: string
    title: string
    a: { status: StepState['status']; gen: number; effectivePass: number; inherited: boolean; signedBy?: string }
    b: { status: StepState['status']; gen: number; effectivePass: number; inherited: boolean; signedBy?: string }
    same: boolean
  }[]
}

export function compareRuns(tpl: ChangeoverTemplate, a: RunState, b: RunState): RunComparison {
  const summary = (r: RunState, id: string) => {
    const st = r.steps[id]
    return {
      status: st.status,
      gen: st.gen,
      effectivePass: effectiveEvidence(r, id).filter((e) => e.result === 'pass').length,
      inherited: !!st.inherited,
      signedBy: st.signedBy,
    }
  }
  return {
    templateId: tpl.id,
    steps: tpl.steps.map((s) => {
      const sa = summary(a, s.id)
      const sb = summary(b, s.id)
      return { code: s.code, title: s.title, a: sa, b: sb, same: JSON.stringify(sa) === JSON.stringify(sb) }
    }),
  }
}
