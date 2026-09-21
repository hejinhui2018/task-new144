import { useState } from 'react';
import { Batch, PostAssignment } from '../core/types';
import { DEFAULT_FROZEN } from '../core/template';
import { useStore } from '../store/StoreContext';
import { uid } from '../core/uid';

/** 启动前录入并冻结基线:产品版本 / 设备配置 / 岗位 / 检查标准 */
export function FreezeForm({ batch }: { batch: Batch }) {
  const { run } = useStore();
  const base = batch.frozen ?? DEFAULT_FROZEN;
  const [productVersion, setProductVersion] = useState(base.productVersion);
  const [equipmentConfig, setEquipmentConfig] = useState(base.equipmentConfig);
  const [inspectionStandard, setInspectionStandard] = useState(base.inspectionStandard);
  const [posts, setPosts] = useState<PostAssignment[]>(base.posts.map((p) => ({ ...p })));
  const valid =
    productVersion.trim().length > 0 &&
    equipmentConfig.trim().length > 0 &&
    inspectionStandard.trim().length > 0 &&
    posts.every((p) => p.operator.trim().length > 0);

  return (
    <section className="card freeze-form">
      <h3>冻结换型基线 — {batch.name}</h3>
      <p className="muted">
        启动后,产品版本、设备配置、岗位与检查标准即冻结,执行期间不可更改;后续步骤全部以此基线为准。
      </p>
      <div className="form-grid">
        <label>
          产品版本
          <input value={productVersion} onChange={(e) => setProductVersion(e.target.value)} />
        </label>
        <label>
          设备配置
          <input value={equipmentConfig} onChange={(e) => setEquipmentConfig(e.target.value)} />
        </label>
        <label>
          检查标准
          <input value={inspectionStandard} onChange={(e) => setInspectionStandard(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend>岗位值守</legend>
        <div className="form-grid">
          {posts.map((p, i) => (
            <label key={p.postId}>
              {p.postName}
              <input
                value={p.operator}
                placeholder="值守人"
                onChange={(e) => setPosts((prev) => prev.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)))}
              />
            </label>
          ))}
        </div>
      </fieldset>
      {batch.derivedFrom && (
        <p className="derived-note">
          本批次派生自 {batch.derivedFrom.batchId} 检查点 {batch.derivedFrom.checkpointStepId},基线预填自源批次,可修订后冻结。
        </p>
      )}
      <button
        className="btn btn-primary btn-lg"
        disabled={!valid}
        onClick={() =>
          run({ id: uid(), type: 'START_BATCH', batchId: batch.id, frozen: { productVersion, equipmentConfig, inspectionStandard, posts } })
        }
      >
        开始换型 · 冻结基线
      </button>
    </section>
  );
}
