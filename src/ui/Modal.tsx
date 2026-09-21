import { useState, type ReactNode } from 'react'

export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={width ? { width } : undefined}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** 原因录入弹窗（暂停/终止/跳过/复测/回退共用） */
export function ReasonPrompt({
  title,
  label = '原因（必填，将进入审计日志）',
  confirmText = '确认',
  danger,
  extra,
  onCancel,
  onConfirm,
}: {
  title: string
  label?: string
  confirmText?: string
  danger?: boolean
  extra?: ReactNode
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal title={title} onClose={onCancel}>
      <label>{label}</label>
      <textarea rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="例如：夜班临时回退灌装量，白班需复核" />
      {extra}
      <div className="foot">
        <button onClick={onCancel}>取消</button>
        <button
          className={danger ? 'danger' : 'primary'}
          disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  )
}
