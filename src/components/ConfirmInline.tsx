import { useState } from 'react';

export interface Field {
  key: string;
  placeholder: string;
  required?: boolean;
  type?: 'text' | 'number';
}

/** 点击后展开为内联表单的按钮,用于需要原因/签收人等输入的操作 */
export function ConfirmInline({
  label,
  fields,
  onConfirm,
  danger,
  small,
}: {
  label: string;
  fields: Field[];
  onConfirm: (values: Record<string, string>) => void;
  danger?: boolean;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const valid = fields.every((f) => !f.required || (values[f.key] ?? '').trim().length > 0);
  const close = () => {
    setOpen(false);
    setValues({});
  };
  if (!open) {
    return (
      <button className={`btn ${danger ? 'btn-danger' : ''} ${small ? 'btn-sm' : ''}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-form">
      {fields.map((f) => (
        <input
          key={f.key}
          type={f.type ?? 'text'}
          placeholder={f.placeholder + (f.required ? ' *' : '')}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
        />
      ))}
      <button
        className={`btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`}
        disabled={!valid}
        onClick={() => {
          onConfirm(values);
          close();
        }}
      >
        确认
      </button>
      <button className="btn btn-sm" onClick={close}>
        取消
      </button>
    </span>
  );
}
