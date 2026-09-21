import type { FrozenContext } from '../engine/types'
import { fmtDateTime } from './format'

export function FrozenPanel({ frozen, derivedFrom }: { frozen: FrozenContext; derivedFrom?: { runId: string; checkpointId: string } }) {
  return (
    <div>
      <div className="frozen-grid">
        <div className="block">
          <h4>产品版本（已冻结）</h4>
          <table>
            <tbody>
              <tr><td>产线</td><td>{frozen.line}</td></tr>
              <tr><td>换出</td><td>{frozen.productFrom.sku} {frozen.productFrom.name}<br /><span className="muted small">{frozen.productFrom.spec}</span></td></tr>
              <tr><td />
                <td><span className="arrow">➜</span></td>
              </tr>
              <tr><td>换入</td><td><strong>{frozen.productTo.sku} {frozen.productTo.name}</strong><br /><span className="muted small">{frozen.productTo.spec}</span></td></tr>
            </tbody>
          </table>
        </div>
        <div className="block">
          <h4>设备配置（已冻结）</h4>
          <table>
            <tbody>
              {frozen.equipmentConfig.map((c) => (
                <tr key={c.name}><td>{c.name}</td><td>{c.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="block">
          <h4>岗位（已冻结）</h4>
          <table>
            <tbody>
              {frozen.posts.map((p) => (
                <tr key={p.role}><td>{p.role}</td><td>{p.operator}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="block">
          <h4>检查标准（已冻结）</h4>
          <table>
            <tbody>
              {frozen.standards.map((s) => (
                <tr key={s.id}><td>{s.id} <span className="muted small">{s.version}</span></td><td>{s.title}</td></tr>
              ))}
            </tbody>
          </table>
          {derivedFrom && (
            <div className="muted small" style={{ marginTop: 6 }}>
              🧬 派生自批次 {derivedFrom.runId} 的检查点 {derivedFrom.checkpointId}
            </div>
          )}
          <div className="muted small" style={{ marginTop: 6 }}>冻结时刻：{fmtDateTime(frozen.frozenAt)}</div>
        </div>
      </div>
    </div>
  )
}
