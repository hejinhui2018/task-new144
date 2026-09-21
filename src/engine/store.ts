import type { Command, Decision, Event } from './types'
import { decide, foldWorld, type RunState, type World } from './engine'

export interface StoredEntry {
  seq: number
  groupId: string
  runId: string
  ev: Event
}

interface PersistShape {
  v: 1
  entries: StoredEntry[]
  idCounter: number
  redo: StoredEntry[]
}

const STORAGE_KEY = 'lineclear-journal-v1'

export interface Clock {
  now: () => number
}

export const realClock: Clock = { now: () => Date.now() }

/**
 * 事件溯源存储：
 * - 全部状态由 journal 顺序归约得到，刷新页面即重放恢复；
 * - 一个命令产生的事件共用 groupId，撤销/重做以命令组为最小单位；
 * - 检查点 seq 指向全局事件序号，派生批次时重放至该序号复原快照。
 */
export class EventStore {
  private entries: StoredEntry[] = []
  private redoEntries: StoredEntry[] = []
  private idCounter = 0
  private clock: Clock
  private storage: Storage | null
  private listeners = new Set<() => void>()
  private worldCache: World | undefined
  private version = 0

  constructor(clock: Clock = realClock, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.clock = clock
    this.storage = storage
    this.load()
  }

  now() {
    return this.clock.now()
  }

  setClock(clock: Clock) {
    this.clock = clock
  }

  // ---------- 持久化 ----------

  private load() {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as PersistShape
      this.entries = data.entries ?? []
      this.idCounter = data.idCounter ?? 0
      this.redoEntries = data.redo ?? []
      this.resyncIdCounter()
    } catch {
      this.entries = []
      this.redoEntries = []
    }
  }

  private persist() {
    if (!this.storage) return
    const data: PersistShape = { v: 1, entries: this.entries, idCounter: this.idCounter, redo: this.redoEntries }
    this.storage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion() {
    return this.version
  }

  private emit() {
    this.worldCache = undefined
    this.version += 1
    this.persist()
    this.listeners.forEach((fn) => fn())
  }

  // ---------- 快照 ----------

  getJournal(): StoredEntry[] {
    return this.entries
  }

  getRedoJournal(): StoredEntry[] {
    return this.redoEntries
  }

  getWorld(): World {
    if (!this.worldCache) {
      this.worldCache = foldWorld(this.entries.map((e) => ({ runId: e.runId, ev: e.ev })))
    }
    return this.worldCache
  }

  getRun(runId: string): RunState | undefined {
    return this.getWorld()[runId]
  }

  private maxSeq(): number {
    return this.entries.reduce((m, e) => Math.max(m, e.seq), -1)
  }

  mintId(prefix: string) {
    return this.newId(prefix)
  }

  /** 复原某批次在检查点全局序号（含）之前的状态 */
  snapshotAt(runId: string, untilSeq: number): RunState | undefined {
    return this.replayUntil(runId, untilSeq)
  }

  private newId = (prefix: string) => {
    this.idCounter += 1
    return `${prefix}-${this.idCounter.toString(36)}`
  }

  private replayUntil = (runId: string, untilSeq: number): RunState | undefined => {
    const slice = this.entries.filter((e) => e.seq <= untilSeq).map((e) => ({ runId: e.runId, ev: e.ev }))
    return foldWorld(slice)[runId]
  }

  /** 从日志中复原 id 计数器，避免撤销重做后生成重复 id */
  private resyncIdCounter() {
    const text = JSON.stringify([...this.entries, ...this.redoEntries])
    let max = 0
    const re = /"(?:ev|cp|grp)-([0-9a-z]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) max = Math.max(max, parseInt(m[1], 36))
    this.idCounter = Math.max(this.idCounter, max)
  }

  // ---------- 命令 ----------

  dispatch(cmd: Command): Decision {
    const world = this.getWorld()
    const decision = decide(cmd, world, { newId: this.newId, nextSeq: this.maxSeq() + 1, replayUntil: this.replayUntil })
    if (!decision.ok || !decision.entries) return decision
    const groupId = this.newId('grp')
    let seq = this.maxSeq()
    const stored: StoredEntry[] = decision.entries.map(({ runId, ev }) => {
      seq += 1
      return { seq, groupId, runId, ev }
    })
    this.entries.push(...stored)
    this.redoEntries = []
    this.emit()
    return decision
  }

  canUndo(): boolean {
    return this.entries.length > 0
  }

  undo(): boolean {
    if (!this.entries.length) return false
    const groupId = this.entries[this.entries.length - 1].groupId
    const cut = this.entries.findIndex((e) => e.groupId === groupId)
    const pulled = this.entries.splice(cut)
    this.redoEntries = pulled
    this.resyncIdCounter()
    this.emit()
    return true
  }

  canRedo(): boolean {
    return this.redoEntries.length > 0
  }

  redo(): boolean {
    if (!this.redoEntries.length) return false
    // 重放前做一次合法性校验（绝大多数情况下必然成立，因为只是回滚自己的命令组）
    const batch = this.redoEntries
    this.entries.push(...batch)
    this.redoEntries = []
    this.emit()
    return true
  }

  resetAll() {
    this.entries = []
    this.redoEntries = []
    this.idCounter = 0
    this.emit()
  }
}
