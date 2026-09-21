import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppState, Command } from '../core/types';
import { ApplyOutcome, initialAppState } from '../core/engine';
import { History, initHistory, apply, undo as hUndo, redo as hRedo } from './history';
import { clearHistory, loadHistory, saveHistory } from '../core/persistence';

const ACTIVE_KEY = 'lineclear.activeBatch';

interface StoreValue {
  state: AppState;
  activeBatchId: string | null;
  selectBatch: (id: string | null) => void;
  run: (cmd: Command) => ApplyOutcome;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  notice: string | null;
  dismissNotice: () => void;
  resetAll: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<History>(() => loadHistory() ?? initHistory(initialAppState()));
  const [activeBatchId, setActiveBatchId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [notice, setNotice] = useState<string | null>(null);

  // 每次状态变化即持久化:刷新/关页后原样恢复(含撤销栈)
  useEffect(() => {
    saveHistory(history);
  }, [history]);
  useEffect(() => {
    try {
      if (activeBatchId) localStorage.setItem(ACTIVE_KEY, activeBatchId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  }, [activeBatchId]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const value: StoreValue = {
    state: history.present,
    activeBatchId,
    selectBatch: setActiveBatchId,
    run: (cmd) => {
      const { history: next, outcome } = apply(history, cmd);
      if (!outcome.ok) setNotice(outcome.error ?? '操作被拒绝');
      else if (outcome.duplicate) setNotice('重复操作,已忽略');
      else setNotice(null);
      setHistory(next);
      return outcome;
    },
    undo: () => setHistory(hUndo(history)),
    redo: () => setHistory(hRedo(history)),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    notice,
    dismissNotice: () => setNotice(null),
    resetAll: () => {
      clearHistory();
      setHistory(initHistory(initialAppState()));
      setActiveBatchId(null);
      setNotice(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used within StoreProvider');
  return v;
}
