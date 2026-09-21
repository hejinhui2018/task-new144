export function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function fmtDateTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  in_progress: '执行中',
  done: '已完成',
  skipped: '已跳过',
  running: '运行中',
  paused: '已暂停',
  closed: '已放行关闭',
  terminated: '已提前终止',
  open: '未开始',
}
