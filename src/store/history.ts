import { AppState, Command } from '../core/types';
import { applyCommand, ApplyOutcome } from '../core/engine';

/** 撤销/重做历史:present 为当前状态,past/future 为快照栈 */
export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

const LIMIT = 80;

export function initHistory(present: AppState): History {
  return { past: [], present, future: [] };
}

/** 应用指令;失败或重复提交不进入历史 */
export function apply(h: History, cmd: Command): { history: History; outcome: ApplyOutcome } {
  const outcome = applyCommand(h.present, cmd);
  if (!outcome.ok || outcome.duplicate) return { history: h, outcome };
  return {
    history: {
      past: [...h.past.slice(-(LIMIT - 1)), h.present],
      present: outcome.state,
      future: [],
    },
    outcome,
  };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future].slice(0, LIMIT),
  };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return {
    past: [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: rest,
  };
}
