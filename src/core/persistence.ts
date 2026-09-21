import { History } from '../store/history';

const KEY = 'lineclear.history.v1';

/** 刷新恢复:整棵历史(含撤销栈)持久化到 localStorage */
export function saveHistory(h: History): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // 存储满/隐私模式下静默失败,不影响演练
  }
}

export function loadHistory(): History | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as History;
    if (!h || typeof h !== 'object' || !h.present || h.present.version !== 1) return null;
    if (!Array.isArray(h.past) || !Array.isArray(h.future)) return null;
    return h;
  } catch {
    return null;
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
