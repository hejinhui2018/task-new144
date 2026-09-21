import { useState } from 'react';
import { useStore } from './store/StoreContext';
import { Sidebar } from './components/Sidebar';
import { FreezeForm } from './components/FreezeForm';
import { Board } from './components/Board';
import { ReleaseTab } from './components/ReleaseTab';
import { LogTab } from './components/LogTab';
import { InboxTab } from './components/InboxTab';
import { CompareTab } from './components/CompareTab';
import { BatchChip } from './components/StatusChip';

type TabKey = 'board' | 'release' | 'log' | 'inbox' | 'compare';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'board', label: '执行看板' },
  { key: 'release', label: '放行依据' },
  { key: 'log', label: '事件日志' },
  { key: 'inbox', label: '待核对区' },
  { key: 'compare', label: '批次对比' },
];

export default function App() {
  const { state, activeBatchId, undo, redo, canUndo, canRedo, notice, dismissNotice, resetAll } = useStore();
  const [tab, setTab] = useState<TabKey>('board');
  const active =
    (activeBatchId ? state.batches[activeBatchId] : null) ??
    (state.batchOrder.length ? state.batches[state.batchOrder[state.batchOrder.length - 1]] : null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          LineClear <span>换型放行演练台</span>
        </div>
        <div className="top-actions">
          <button className="btn btn-sm" disabled={!canUndo} onClick={undo} title="撤销上一步操作">
            ↩ 撤销
          </button>
          <button className="btn btn-sm" disabled={!canRedo} onClick={redo} title="重做">
            ↪ 重做
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (window.confirm('清空全部本地演练数据?')) resetAll();
            }}
          >
            重置演练
          </button>
        </div>
      </header>
      <div className="layout">
        <Sidebar />
        <main>
          {!active ? (
            <section className="card empty">
              <h3>还没有换型批次</h3>
              <p className="muted">在左侧新建一个批次,冻结基线后开始演练换型放行流程。</p>
            </section>
          ) : (
            <>
              <div className="active-head">
                <h2>
                  {active.id} · {active.name}
                </h2>
                <BatchChip status={active.status} decision={active.closeDecision} />
              </div>
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                    {t.label}
                    {t.key === 'inbox' && state.lateInbox.length > 0 ? ` (${state.lateInbox.length})` : ''}
                  </button>
                ))}
              </nav>
              {tab === 'board' &&
                (active.status === 'draft' ? <FreezeForm batch={active} /> : <Board batch={active} goRelease={() => setTab('release')} />)}
              {tab === 'release' && (active.status === 'draft' ? <FreezeForm batch={active} /> : <ReleaseTab batch={active} />)}
              {tab === 'log' && <LogTab batch={active} />}
              {tab === 'inbox' && <InboxTab />}
              {tab === 'compare' && <CompareTab />}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" onClick={dismissNotice} role="alert">
          {notice}
        </div>
      )}
    </div>
  );
}
