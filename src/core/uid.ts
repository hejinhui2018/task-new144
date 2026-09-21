let seq = 0;

/** 指令/实体的幂等 id(本地模拟,无需密码学强度) */
export function uid(prefix = 'C'): string {
  seq = (seq + 1) % 46656;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
