import {
  AppState,
  Batch,
  Command,
  Evidence,
  EvidenceStatus,
  FrozenContext,
  LogEvent,
  ReleaseBasis,
  StepState,
  StepTemplate,
} from './types';
import { STATIONS, TEMPLATE } from './template';
import { transitiveDependents, transitiveDeps } from './dependency';
import { EXEC_LABEL, depSatisfied, releaseBlockers, stationName, stationOccupant } from './selectors';

export interface ApplyOutcome {
  state: AppState;
  ok: boolean;
  /** 指令 id 已应用过,本次为重复提交,状态原样返回 */
  duplicate?: boolean;
  error?: string;
  meta?: { batchId?: string };
}

export function initialAppState(): AppState {
  return {
    version: 1,
    batches: {},
    batchOrder: [],
    lateInbox: [],
    clock: 0,
    eventSeq: 0,
    batchSeq: 0,
    evSeq: 0,
    appliedCommandIds: [],
  };
}

function freshSteps(template: StepTemplate[]): Record<string, StepState> {
  const steps: Record<string, StepState> = {};
  for (const t of template) {
    steps[t.id] = {
      id: t.id,
      exec: 'idle',
      generation: 0,
      invalidations: 0,
      startedAt: null,
      completedAt: null,
      pauseReason: null,
      skipReason: null,
      signedBy: null,
      signedAt: null,
      inheritedFrom: null,
    };
  }
  return steps;
}

function notRunningMsg(batch: Batch): string | null {
  if (batch.status === 'running') return null;
  if (batch.status === 'interrupted') return '批次已中断,请先续作';
  if (batch.status === 'closed') return '批次已关闭,禁止操作';
  return '批次未开始,请先冻结基线并启动';
}

const MAX_CMD_IDS = 2000;

export function applyCommand(input: AppState, cmd: Command): ApplyOutcome {
  // 幂等:同一指令 id 重复提交(网络重试/双击/刷新重放)不产生第二次副作用
  if (input.appliedCommandIds.includes(cmd.id)) {
    return { state: input, ok: true, duplicate: true };
  }
  const state = structuredClone(input);
  state.clock += 1;
  const at = state.clock;

  const fail = (error: string): ApplyOutcome => ({ state: input, ok: false, error });
  const finish = (meta?: ApplyOutcome['meta']): ApplyOutcome => {
    state.appliedCommandIds.push(cmd.id);
    if (state.appliedCommandIds.length > MAX_CMD_IDS) {
      state.appliedCommandIds = state.appliedCommandIds.slice(-MAX_CMD_IDS);
    }
    return { state, ok: true, meta };
  };
  const log = (batch: Batch, kind: LogEvent['kind'], message: string) => {
    state.eventSeq += 1;
    batch.events.push({ seq: state.eventSeq, at, batchId: batch.id, kind, message });
  };
  const makeEvidence = (
    batch: Batch,
    stepId: string,
    generation: number,
    title: string,
    value: string,
    submittedBy: string,
    status: EvidenceStatus,
  ): Evidence => {
    state.evSeq += 1;
    return {
      id: `E${String(state.evSeq).padStart(3, '0')}`,
      batchId: batch.id,
      stepId,
      generation,
      title,
      value,
      submittedBy,
      at,
      status,
      inheritedFromBatch: null,
      reviewNote: null,
    };
  };
  /** 复测/回退:目标及其全部传递下游失效,代次 +1;旧证据标记失效但保留 */
  const invalidateChain = (batch: Batch, targetId: string, cause: string) => {
    const affected = [targetId, ...transitiveDependents(batch.template, targetId)];
    for (const id of affected) {
      const s = batch.steps[id];
      if (id !== targetId && s.exec === 'idle') continue; // 未执行过的下游无需失效
      for (const ev of batch.evidence) {
        if (ev.stepId === id && ev.status === 'valid') ev.status = 'superseded';
      }
      s.exec = 'idle';
      s.generation += 1;
      s.invalidations += 1;
      s.signedBy = null;
      s.signedAt = null;
      s.startedAt = null;
      s.completedAt = null;
      s.pauseReason = null;
      s.skipReason = null;
      if (id !== targetId) {
        const name = batch.template.find((t) => t.id === id)?.name ?? id;
        log(batch, 'step', `${id} ${name} 因 ${targetId} ${cause} 失效,需重新执行;旧证据保留为失效档案`);
      }
    }
  };
  // 显式返回类型:推断的联合会被 TS 补上 error?: undefined 可选成员,使 in 收窄失效
  type StepCtx = { error: string } | { batch: Batch; tpl: StepTemplate; st: StepState };
  const getStep = (batchId: string, stepId: string): StepCtx => {
    const batch = state.batches[batchId];
    if (!batch) return { error: '批次不存在' };
    const tpl = batch.template.find((t) => t.id === stepId);
    if (!tpl) return { error: `步骤 ${stepId} 不存在` };
    return { batch, tpl, st: batch.steps[stepId] };
  };
  const buildBasis = (batch: Batch): ReleaseBasis => {
    const doneSteps = batch.template.filter((t) => batch.steps[t.id].exec === 'done').map((t) => t.id);
    const skippedSteps = batch.template.filter((t) => batch.steps[t.id].exec === 'skipped').map((t) => t.id);
    return {
      doneSteps,
      skippedSteps,
      validEvidence: batch.evidence.filter((e) => e.status === 'valid').length,
      supersededEvidence: batch.evidence.filter((e) => e.status === 'superseded').length,
      signoffs: doneSteps.map((id) => ({ stepId: id, signedBy: batch.steps[id].signedBy ?? '' })),
    };
  };

  switch (cmd.type) {
    case 'CREATE_BATCH': {
      const template = cmd.template ?? TEMPLATE;
      const stations = cmd.stations ?? STATIONS;
      state.batchSeq += 1;
      const id = `B${String(state.batchSeq).padStart(2, '0')}`;
      const batch: Batch = {
        id,
        name: cmd.name.trim() || `换型批次 ${id}`,
        status: 'draft',
        closeDecision: null,
        closeReason: null,
        template: structuredClone(template),
        stations: structuredClone(stations),
        steps: freshSteps(template),
        frozen: null,
        evidence: [],
        events: [],
        derivedFrom: null,
        release: null,
        createdAt: at,
        startedAt: null,
        closedAt: null,
      };
      state.batches[id] = batch;
      state.batchOrder.push(id);
      log(batch, 'batch', `批次 ${id} 已创建,装载模板 ${template.length} 个步骤`);
      return finish({ batchId: id });
    }

    case 'START_BATCH': {
      const batch = state.batches[cmd.batchId];
      if (!batch) return fail('批次不存在');
      if (batch.status !== 'draft') return fail('批次已开始,基线不能重复冻结');
      const frozen: FrozenContext = { ...structuredClone(cmd.frozen), frozenAt: at };
      batch.frozen = frozen;
      batch.status = 'running';
      batch.startedAt = at;
      log(
        batch,
        'batch',
        `批次开始,基线已冻结:产品版本「${frozen.productVersion}」/ 设备配置「${frozen.equipmentConfig}」/ 检查标准「${frozen.inspectionStandard}」/ 岗位 ${frozen.posts.length} 个`,
      );
      return finish();
    }

    case 'START_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'idle') return fail(`步骤 ${tpl.id} 当前为「${EXEC_LABEL[st.exec]}」,不能重复开始`);
      if (!cmd.operator.trim()) return fail('请填写执行人/岗位');
      for (const d of tpl.deps) {
        if (!depSatisfied(batch.steps[d])) return fail(`前置步骤 ${d} 未完成,${tpl.id} 不可开始`);
      }
      const occ = stationOccupant(batch, tpl.stationId, tpl.id);
      if (occ) return fail(`工位互锁:${stationName(batch, tpl.stationId)}正被步骤 ${occ} 占用`);
      st.exec = 'in_progress';
      st.startedAt = at;
      st.pauseReason = null;
      log(batch, 'step', `${cmd.operator} 开始 ${tpl.id} ${tpl.name}(第 ${st.generation + 1} 代执行)`);
      return finish();
    }

    case 'PAUSE_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'in_progress') return fail('仅进行中的步骤可暂停');
      if (!cmd.reason.trim()) return fail('暂停需填写原因');
      st.exec = 'paused';
      st.pauseReason = cmd.reason;
      log(batch, 'step', `${tpl.id} 暂停:${cmd.reason}`);
      return finish();
    }

    case 'RESUME_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'paused') return fail('仅已暂停的步骤可继续');
      st.exec = 'in_progress';
      st.pauseReason = null;
      log(batch, 'step', `${tpl.id} 继续执行`);
      return finish();
    }

    case 'COMPLETE_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'in_progress') return fail(`仅进行中的步骤可完成(当前:${EXEC_LABEL[st.exec]})`);
      if (tpl.requiresEvidence && !cmd.evidence) return fail(`${tpl.id} 要求提交证据后才能完成`);
      if (cmd.evidence && !cmd.evidence.title.trim()) return fail('证据标题不能为空');
      if (!cmd.operator.trim()) return fail('请填写执行人/岗位');
      if (cmd.evidence) {
        const ev = makeEvidence(batch, tpl.id, st.generation, cmd.evidence.title, cmd.evidence.value, cmd.operator, 'valid');
        batch.evidence.push(ev);
        log(batch, 'evidence', `${tpl.id} 证据 ${ev.id}「${ev.title}」已记录(第 ${st.generation + 1} 代)`);
      }
      st.exec = 'done';
      st.completedAt = at;
      log(batch, 'step', `${cmd.operator} 完成 ${tpl.id} ${tpl.name}`);
      return finish();
    }

    case 'SKIP_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'idle') return fail('已开始的步骤不能跳过,如需重来请回退');
      if (!cmd.reason.trim()) return fail('跳过需填写原因');
      for (const d of tpl.deps) {
        if (!depSatisfied(batch.steps[d])) return fail(`前置步骤 ${d} 未完成,不能跳过`);
      }
      st.exec = 'skipped';
      st.skipReason = cmd.reason;
      log(batch, 'step', `${cmd.operator} 跳过 ${tpl.id}:${cmd.reason}`);
      return finish();
    }

    case 'RETEST_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'done') return fail('仅已完成的步骤可复测');
      if (!cmd.reason.trim()) return fail('复测需填写原因');
      log(batch, 'step', `${cmd.operator} 对 ${tpl.id} 启动复测:${cmd.reason}`);
      invalidateChain(batch, tpl.id, '复测');
      st.exec = 'in_progress';
      st.startedAt = at;
      return finish();
    }

    case 'ROLLBACK_STEP': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'done' && st.exec !== 'skipped') return fail('仅已完成或已跳过的步骤可回退');
      if (!cmd.reason.trim()) return fail('回退需填写原因');
      log(batch, 'step', `${cmd.operator} 回退 ${tpl.id}:${cmd.reason}`);
      invalidateChain(batch, tpl.id, '回退');
      return finish();
    }

    case 'SIGN_OFF': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      const nr = notRunningMsg(batch);
      if (nr) return fail(nr);
      if (st.exec !== 'done') return fail('仅已完成的步骤可签收');
      if (st.signedBy) return fail('该步骤已签收,请勿重复签收');
      if (!cmd.signer.trim()) return fail('请填写签收人');
      st.signedBy = cmd.signer;
      st.signedAt = at;
      log(batch, 'step', `${cmd.signer} 签收 ${tpl.id} ${tpl.name}`);
      return finish();
    }

    case 'SUBMIT_EVIDENCE': {
      const ctx = getStep(cmd.batchId, cmd.stepId);
      if ('error' in ctx) return fail(ctx.error);
      const { batch, tpl, st } = ctx;
      if (!cmd.title.trim()) return fail('证据标题不能为空');
      if (!cmd.submittedBy.trim()) return fail('请填写提交人');
      // 批次已关闭:迟到回执只进待核对区,不改写任何结论
      if (batch.status === 'closed') {
        const ev = makeEvidence(batch, tpl.id, cmd.forGeneration ?? st.generation, cmd.title, cmd.value, cmd.submittedBy, 'late_pending');
        state.lateInbox.push(ev);
        log(batch, 'evidence', `迟到回执 ${ev.id}「${ev.title}」进入待核对区;批次已关闭,结论不受影响`);
        return finish();
      }
      const gen = cmd.forGeneration ?? st.generation;
      if (gen < st.generation) {
        // 过期代次的回执(如上一次换线的迟到结果):归档为失效,不覆盖当前结论
        const ev = makeEvidence(batch, tpl.id, gen, cmd.title, cmd.value, cmd.submittedBy, 'superseded');
        batch.evidence.push(ev);
        log(batch, 'evidence', `过期回执 ${ev.id}(第 ${gen + 1} 代)已归档为失效证据,未覆盖当前结论`);
      } else {
        const ev = makeEvidence(batch, tpl.id, gen, cmd.title, cmd.value, cmd.submittedBy, 'valid');
        batch.evidence.push(ev);
        log(batch, 'evidence', `${tpl.id} 补充证据 ${ev.id}「${ev.title}」已记录`);
      }
      return finish();
    }

    case 'INTERRUPT_BATCH': {
      const batch = state.batches[cmd.batchId];
      if (!batch) return fail('批次不存在');
      if (batch.status !== 'running') return fail('仅运行中的批次可中断');
      if (!cmd.reason.trim()) return fail('中断需填写原因');
      batch.status = 'interrupted';
      for (const t of batch.template) {
        const s = batch.steps[t.id];
        if (s.exec === 'in_progress') {
          s.exec = 'paused';
          s.pauseReason = `中断:${cmd.reason}`;
        }
      }
      log(batch, 'batch', `批次中断:${cmd.reason};进行中的步骤已自动暂停,可续作`);
      return finish();
    }

    case 'RESUME_BATCH': {
      const batch = state.batches[cmd.batchId];
      if (!batch) return fail('批次不存在');
      if (batch.status !== 'interrupted') return fail('仅中断中的批次可续作');
      batch.status = 'running';
      log(batch, 'batch', '批次续作,各暂停步骤可继续');
      return finish();
    }

    case 'CLOSE_BATCH': {
      const batch = state.batches[cmd.batchId];
      if (!batch) return fail('批次不存在');
      if (!cmd.operator.trim()) return fail('请填写操作人');
      if (cmd.decision === 'released') {
        if (batch.status !== 'running') {
          return fail(batch.status === 'interrupted' ? '批次中断中,请先续作再放行' : '仅运行中的批次可放行');
        }
        const blockers = releaseBlockers(batch);
        if (blockers.length > 0) return fail(`不具备放行条件:${blockers.join(';')}`);
      } else {
        if (batch.status !== 'running' && batch.status !== 'interrupted') return fail('批次已关闭或未开始');
        if (!cmd.reason.trim()) return fail('提前终止需填写原因');
        for (const t of batch.template) {
          const s = batch.steps[t.id];
          if (s.exec === 'in_progress') {
            s.exec = 'paused';
            s.pauseReason = '批次提前终止';
          }
        }
      }
      batch.status = 'closed';
      batch.closeDecision = cmd.decision;
      batch.closeReason = cmd.reason;
      batch.closedAt = at;
      batch.release = { decision: cmd.decision, reason: cmd.reason, operator: cmd.operator, at, basis: buildBasis(batch) };
      log(
        batch,
        'release',
        cmd.decision === 'released' ? `${cmd.operator} 放行批次 ${batch.id}` : `批次提前终止:${cmd.reason}`,
      );
      return finish();
    }

    case 'DERIVE_BATCH': {
      const src = state.batches[cmd.sourceBatchId];
      if (!src) return fail('源批次不存在');
      const cpTpl = src.template.find((t) => t.id === cmd.checkpointStepId);
      if (!cpTpl) return fail('检查点不存在');
      if (cpTpl.kind !== 'checkpoint') return fail('仅检查点步骤可作为派生来源');
      if (src.steps[cpTpl.id].exec !== 'done') return fail('检查点尚未完成,不能派生新批次');
      const candidates = new Set([cpTpl.id, ...transitiveDeps(src.template, cpTpl.id)]);
      const inherit = new Set(cmd.inheritStepIds);
      for (const id of inherit) {
        if (!candidates.has(id)) return fail(`步骤 ${id} 不在检查点 ${cpTpl.id} 的可继承范围内`);
        const ss = src.steps[id];
        if (ss.exec !== 'done' && ss.exec !== 'skipped') return fail(`步骤 ${id} 在源批次无有效结果,不可继承`);
      }
      for (const id of inherit) {
        const t = src.template.find((x) => x.id === id)!;
        for (const d of t.deps) {
          if (!inherit.has(d)) return fail(`继承 ${id} 需同时继承其前置步骤 ${d}`);
        }
      }
      state.batchSeq += 1;
      const id = `B${String(state.batchSeq).padStart(2, '0')}`;
      const batch: Batch = {
        id,
        name: cmd.name.trim() || `派生批次 ${id}`,
        status: 'draft',
        closeDecision: null,
        closeReason: null,
        template: structuredClone(src.template),
        stations: structuredClone(src.stations),
        steps: freshSteps(src.template),
        frozen: src.frozen ? structuredClone(src.frozen) : null,
        evidence: [],
        events: [],
        derivedFrom: { batchId: src.id, checkpointStepId: cpTpl.id },
        release: null,
        createdAt: at,
        startedAt: null,
        closedAt: null,
      };
      for (const sid of inherit) {
        const ss = src.steps[sid];
        const ns = batch.steps[sid];
        ns.exec = ss.exec;
        ns.skipReason = ss.skipReason;
        ns.signedBy = ss.signedBy;
        ns.signedAt = ss.signedAt;
        ns.inheritedFrom = src.id;
        for (const ev of src.evidence) {
          if (ev.stepId === sid && ev.status === 'valid') {
            const copy = makeEvidence(batch, sid, 0, ev.title, ev.value, ev.submittedBy, 'valid');
            copy.inheritedFromBatch = src.id;
            batch.evidence.push(copy);
          }
        }
      }
      state.batches[id] = batch;
      state.batchOrder.push(id);
      log(batch, 'derive', `自批次 ${src.id} 检查点 ${cpTpl.id} 派生;继承 ${inherit.size} 个有效结果,其余步骤需重新执行`);
      log(src, 'derive', `派生出新批次 ${id}(检查点 ${cpTpl.id})`);
      return finish({ batchId: id });
    }

    case 'REVIEW_LATE_EVIDENCE': {
      const idx = state.lateInbox.findIndex((e) => e.id === cmd.evidenceId);
      if (idx < 0) return fail('回执不存在或已处理');
      const ev = state.lateInbox[idx];
      const batch = state.batches[ev.batchId];
      if (!batch) return fail('批次不存在');
      if (!cmd.reviewer.trim()) return fail('请填写核对人');
      // 核对只决定归档去向,不回写步骤状态,也不改动已关闭批次的结论
      ev.status = cmd.accept ? 'late_accepted' : 'rejected';
      ev.reviewNote = cmd.note;
      state.lateInbox.splice(idx, 1);
      batch.evidence.push(ev);
      log(batch, 'review', `迟到回执 ${ev.id} ${cmd.accept ? '已采纳归档' : '已驳回'}(${cmd.reviewer}:${cmd.note || '无备注'});批次结论不变`);
      return finish();
    }

    default:
      return fail('未知指令');
  }
}
