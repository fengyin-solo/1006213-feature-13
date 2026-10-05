/** 位移台账事务层：台账与处置待办存在同一份文档里，一个测次的导入整笔提交。
 * 构造阶段任何一步抛错都不会写回——事务没走完整笔退回，不留中间态。 */

import { isOverLimit, parseDate, parseNumber, ratioOf, resultant, round1, roundRatio } from './calc'
import { LEGACY_OBSERVATIONS, LEGACY_POINTS, LEGACY_SESSIONS } from './legacy'
import { parseFieldText } from './parser'
import type {
  ImportBatch,
  LedgerState,
  Observation,
  Point,
  RejectedRow,
  TodoItem,
} from './types'

const STORAGE_KEY = 'hydropower-plant-om:displacement-ledger'

/** 高程逐行核对容差，单位 m（外业抄录与台账允许 2cm 量取差）。 */
export const ELEVATION_TOLERANCE = 0.02

export interface ViewRow {
  point: Point
  latest: Observation | null
  dx: number | null
  dy: number | null
  resultantMm: number | null
  ratio: number | null
  overLimit: boolean
  sessionCode: string | null
  obsDate: string | null
  dateSource: Observation['dateSource'] | null
  totalObservations: number
}

export interface ImportOutcome {
  importId: number
  sessionCode: string
  accepted: number
  rejected: number
  replacedSession: boolean
  ignoredCumulativeColumn: boolean
  rejectedRows: Array<{ lineNo: number; pointCode: string; reason: string; rawLine: string }>
}

function emptyState(): LedgerState {
  return {
    version: 1,
    counters: { point: 0, observation: 0, rejection: 0, importBatch: 0, todo: 0 },
    points: [],
    observations: [],
    rejections: [],
    imports: [],
    todos: [],
    migrated: false,
    migratedAt: null,
  }
}

let cache: LedgerState | null = null

function readState(): LedgerState {
  if (cache) return cache
  const fallback = emptyState()
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = fallback
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      cache = { ...emptyState(), ...(JSON.parse(raw) as LedgerState) }
    } catch {
      cache = fallback
    }
  } else {
    cache = fallback
  }
  if (!cache.migrated) {
    runMigration(cache)
    persist(cache)
  }
  return cache
}

/** 唯一写入口：内存与本地存储要么一起成功，要么一起不动。 */
function persist(state: LedgerState): void {
  const serialized = JSON.stringify(state)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = state
}

/** 在草稿上做改动，异常时草稿作废，已提交的那版保持原样。 */
function transact<T>(fn: (draft: LedgerState) => T): T {
  const current = readState()
  const draft: LedgerState = JSON.parse(JSON.stringify(current)) as LedgerState
  const result = fn(draft)
  persist(draft)
  return result
}

function nowStamp(): string {
  return new Date().toISOString()
}

function runMigration(state: LedgerState): void {
  const stamp = nowStamp()
  LEGACY_POINTS.forEach((item) => {
    state.counters.point += 1
    const point: Point = {
      id: state.counters.point,
      code: item.code,
      elevation: item.elevation,
      allowable: item.allowable,
      frequency: item.frequency,
      createdAt: stamp,
    }
    state.points.push(point)
  })
  // 存量按发生顺序迁移：数组顺序即测次先后，早期纸档保持原样（无日期）。
  LEGACY_SESSIONS.forEach((session, sessionIndex) => {
    LEGACY_OBSERVATIONS.filter((item) => item.sessionCode === session.code).forEach((item) => {
      state.counters.observation += 1
      state.observations.push({
        id: state.counters.observation,
        sessionCode: session.code,
        pointCode: item.pointCode,
        elevation: item.elevation,
        obsDate: session.date,
        dateSource: session.paper ? 'paper' : 'dated',
        seq: sessionIndex + 1,
        dx: item.dx,
        dy: item.dy,
        importId: null,
        migrated: true,
      })
    })
  })
  reconcileTodos(state)
  state.migrated = true
  state.migratedAt = stamp
}

function pointMap(state: LedgerState): Map<string, Point> {
  return new Map(state.points.map((point) => [point.code, point]))
}

/** 同一测点的最新一条：有日期的按观测日期，纸档永远排在有日期的之前；同日按录入顺序。 */
export function latestObservation(
  observations: Observation[],
  pointCode: string,
): Observation | null {
  const rows = observations
    .filter((item) => item.pointCode === pointCode)
    .sort((a, b) => {
      if (a.dateSource !== b.dateSource) return a.dateSource === 'paper' ? -1 : 1
      if (a.obsDate && b.obsDate && a.obsDate !== b.obsDate) return a.obsDate < b.obsDate ? -1 : 1
      if (a.seq !== b.seq) return a.seq - b.seq
      return a.id - b.id
    })
  return rows.length ? rows[rows.length - 1] : null
}

export function buildViewRows(state: LedgerState): ViewRow[] {
  return state.points
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((point) => {
      const latest = latestObservation(state.observations, point.code)
      if (!latest) {
        return {
          point,
          latest: null,
          dx: null,
          dy: null,
          resultantMm: null,
          ratio: null,
          overLimit: false,
          sessionCode: null,
          obsDate: null,
          dateSource: null,
          totalObservations: 0,
        }
      }
      const ratio = ratioOf(latest.dx, latest.dy, point.allowable)
      return {
        point,
        latest,
        dx: latest.dx,
        dy: latest.dy,
        resultantMm: round1(resultant(latest.dx, latest.dy)),
        ratio,
        overLimit: isOverLimit(ratio),
        sessionCode: latest.sessionCode,
        obsDate: latest.obsDate,
        dateSource: latest.dateSource,
        totalObservations: state.observations.filter((item) => item.pointCode === point.code).length,
      }
    })
}

/** 按当前台账结论重建超限处置待办：台账与业务清单一起变。
 * - 只对有确切观测日期的超限建待办（纸档待核不自动报）；
 * - 已存在的（测次+测点）保留其办结状态，不重复登记；
 * - 超限不再成立的自动待办标陈旧留痕，值班入口不再看到它。 */
export function reconcileTodos(state: LedgerState): void {
  const points = pointMap(state)
  const activeKeys = new Set<string>()
  state.observations.forEach((obs) => {
    const point = points.get(obs.pointCode)
    if (!point || obs.dateSource === 'paper' || !obs.obsDate) return
    const ratio = ratioOf(obs.dx, obs.dy, point.allowable)
    if (!isOverLimit(ratio)) return
    const key = obs.sessionCode + ' ' + point.code
    activeKeys.add(key)
    const existing = state.todos.find(
      (todo) => todo.auto && todo.sessionCode === obs.sessionCode && todo.pointCode === point.code,
    )
    if (existing) {
      if (existing.status === 'closed') return
      existing.stale = false
      existing.ratio = roundRatio(ratio)
      existing.obsDate = obs.obsDate
      existing.detail = buildTodoDetail(point, obs, ratio)
      return
    }
    state.counters.todo += 1
    const todo: TodoItem = {
      id: state.counters.todo,
      kind: 'overlimit',
      title: point.code + ' 位移超限（测次 ' + obs.sessionCode + '）',
      detail: buildTodoDetail(point, obs, ratio),
      pointCode: point.code,
      sessionCode: obs.sessionCode,
      obsDate: obs.obsDate,
      ratio: roundRatio(ratio),
      status: 'open',
      stale: false,
      auto: true,
      createdAt: nowStamp(),
      closedAt: null,
    }
    state.todos.push(todo)
  })
  state.todos.forEach((todo) => {
    if (todo.auto && todo.status === 'open' && !activeKeys.has(todo.sessionCode + ' ' + todo.pointCode)) {
      todo.stale = true
    }
  })
}

function buildTodoDetail(point: Point, obs: Observation, ratio: number): string {
  return `测次 ${obs.sessionCode}（${obs.obsDate ?? '日期待核'}）合位移 ${round1(
    resultant(obs.dx, obs.dy),
  )}mm，允许位移 ${point.allowable}mm，占比 ${(ratio * 100).toFixed(1)}%；水平 ${obs.dx}mm、垂直 ${obs.dy}mm，测点高程 ${point.elevation}m。`
}

interface ParsedImportInput {
  sessionCode: string
  fileName: string
  rawText: string
}

/** 整批导入：逐行核对测点编号/高程/日期，不过的行另摘一行写缘由，其余照常入库。
 * 同一测次重复导入以最后一次为准：旧观测整版被覆盖并进留痕快照。 */
export function importSession(input: ParsedImportInput): ImportOutcome {
  const sessionCode = input.sessionCode.trim()
  if (!sessionCode) {
    throw new Error('测次号不能为空，请填写或使用文件抬头里的测次号')
  }
  return transact((draft) => {
    const points = pointMap(draft)
    const parsed = parseFieldText(input.rawText)
    const headerDate = parsed.headerDate ? parseDate(parsed.headerDate) : null
    if (parsed.headerDate && !headerDate) {
      // 抬头日期写了但不是合法日期：整笔退回，不留任何半截记录。
      throw new Error(`测次抬头日期「${parsed.headerDate}」无法识别为合法日期`)
    }

    const accepted: Array<Omit<Observation, 'id'>> = []
    const rejected: ImportOutcome['rejectedRows'] = []
    const sessionSeq =
      Math.max(
        -1,
        ...draft.observations
          .filter((item) => item.dateSource === 'dated')
          .map((item) => item.seq),
      ) + 1

    // 同一测点在本批次第一次出现的行号：重复登记只认第一次，其后的行（哪怕第一次那行
    // 本身核对不过）一律按重复另摘，不允许后面的行顶替取值。
    const firstLineByCode = new Map<string, number>()
    parsed.lines.forEach((line) => {
      if (!line.dataLine) return
      const code = (line.byKey.code ?? '').trim()
      if (code && !firstLineByCode.has(code)) firstLineByCode.set(code, line.lineNo)
    })

    parsed.lines.forEach((line) => {
      const code = (line.byKey.code ?? '').trim()
      const reject = (reason: string) =>
        rejected.push({ lineNo: line.lineNo, pointCode: code, reason, rawLine: line.rawLine })

      if (!line.dataLine) {
        if (line.reason) reject(line.reason)
        return
      }

      if (firstLineByCode.get(code) !== line.lineNo) {
        reject(`同一批次内测点 ${code} 重复登记，按规则只认第一次取值，本行不入库`)
        return
      }

      const point = points.get(code)
      if (!point) {
        reject(`测点编号 ${code} 在测点台账中不存在，请先核对测点编号`)
        return
      }

      const elevation = parseNumber(line.byKey.elevation ?? '')
      if (elevation === null) {
        reject(`测点高程「${line.byKey.elevation ?? ''}」不是数值`)
        return
      }
      if (Math.abs(elevation - point.elevation) > ELEVATION_TOLERANCE) {
        reject(
          `测点高程不符：外业 ${elevation}m 与台账 ${point.elevation}m 相差 ${round1(
            Math.abs(elevation - point.elevation) * 1000,
          )}mm（容差 ${ELEVATION_TOLERANCE * 1000}mm）`,
        )
        return
      }

      const dx = parseNumber(line.byKey.dx ?? '')
      const dy = parseNumber(line.byKey.dy ?? '')
      if (dx === null) {
        reject(`水平位移「${line.byKey.dx ?? ''}」不是数值`)
        return
      }
      if (dy === null) {
        reject(`垂直位移「${line.byKey.dy ?? ''}」不是数值`)
        return
      }

      const dateRaw = line.byKey.date ? parseDate(line.byKey.date) : headerDate
      if (line.byKey.date && !dateRaw) {
        reject(`观测日期「${line.byKey.date}」无法识别为合法日期（支持 2026-09-01、2026/9/1、2026年9月1日）`)
        return
      }
      if (!dateRaw) {
        reject('缺少观测日期：行内未写日期，且测次抬头也没有观测日期')
        return
      }

      accepted.push({
        sessionCode,
        pointCode: code,
        elevation: point.elevation,
        obsDate: dateRaw,
        dateSource: 'dated',
        seq: sessionSeq,
        dx,
        dy,
        importId: null,
        migrated: false,
      })
    })

    if (accepted.length === 0) {
      // 没有任何一行能入库：整笔退回，不产生空测次版本。
      throw new Error(
        rejected.length
          ? `没有可入库的行（${rejected.length} 行全部未通过核对），本次导入整笔退回：${rejected[0].reason}`
          : '文件里没有可识别的观测数据行',
      )
    }

    // 同一测次旧版本整版覆盖，旧值留快照。
    const oldRows = draft.observations.filter((item) => item.sessionCode === sessionCode)
    const replacedSnapshot = oldRows.map((item) => ({
      pointCode: item.pointCode,
      obsDate: item.obsDate,
      dx: item.dx,
      dy: item.dy,
    }))
    const oldBatch = [...draft.imports]
      .reverse()
      .find((batch) => batch.sessionCode === sessionCode && !batch.superseded)
    if (oldBatch) oldBatch.superseded = true
    draft.observations = draft.observations.filter((item) => item.sessionCode !== sessionCode)

    draft.counters.importBatch += 1
    const importId = draft.counters.importBatch
    accepted.forEach((item) => {
      draft.counters.observation += 1
      draft.observations.push({ ...item, id: draft.counters.observation, importId })
    })
    rejected.forEach((item) => {
      draft.counters.rejection += 1
      const row: RejectedRow = {
        id: draft.counters.rejection,
        sessionCode,
        importId,
        lineNo: item.lineNo,
        rawLine: item.rawLine,
        pointCode: item.pointCode,
        reason: item.reason,
        createdAt: nowStamp(),
      }
      draft.rejections.push(row)
    })

    const batch: ImportBatch = {
      id: importId,
      sessionCode,
      fileName: input.fileName,
      headerDate,
      importedAt: nowStamp(),
      accepted: accepted.length,
      rejected: rejected.length,
      replacedSession: oldRows.length > 0,
      superseded: false,
      rawText: input.rawText,
      replacedSnapshot,
      ignoredCumulativeColumn: parsed.cumulativeColumnDetected,
    }
    draft.imports.push(batch)

    reconcileTodos(draft)

    return {
      importId,
      sessionCode,
      accepted: accepted.length,
      rejected: rejected.length,
      replacedSession: batch.replacedSession,
      ignoredCumulativeColumn: batch.ignoredCumulativeColumn,
      rejectedRows: rejected,
    }
  })
}

/** 纸档补录：核对到实际观测日期后，把早期无日期的整测次转正。原始读数保持原样。 */
export function backfillSessionDate(sessionCode: string, dateRaw: string): void {
  const date = parseDate(dateRaw)
  if (!date) {
    throw new Error(`补录日期「${dateRaw}」无法识别为合法日期`)
  }
  transact((draft) => {
    const rows = draft.observations.filter(
      (item) => item.sessionCode === sessionCode && item.dateSource === 'paper',
    )
    if (!rows.length) {
      throw new Error(`没有找到测次「${sessionCode}」的纸档待核记录`)
    }
    const maxSeq = Math.max(...draft.observations.filter((item) => item.obsDate).map((item) => item.seq))
    rows.forEach((row) => {
      row.obsDate = date
      row.dateSource = 'dated'
      row.seq = maxSeq + 1
    })
    reconcileTodos(draft)
  })
}

export function closeTodo(id: number): void {
  transact((draft) => {
    const todo = draft.todos.find((item) => item.id === id)
    if (!todo) throw new Error(`没有找到待办 #${id}`)
    todo.status = 'closed'
    todo.closedAt = nowStamp()
  })
}

export function getLedger(): { state: LedgerState; views: ViewRow[] } {
  const state = readState()
  return { state, views: buildViewRows(state) }
}

export interface SessionView {
  sessionCode: string
  obsDate: string | null
  dateSource: Observation['dateSource']
  rows: number
  overLimit: number
  migrated: boolean
  importId: number | null
}

export function listSessions(): SessionView[] {
  const { state } = getLedger()
  const points = pointMap(state)
  const map = new Map<string, Observation[]>()
  state.observations.forEach((obs) => {
    const list = map.get(obs.sessionCode) ?? []
    list.push(obs)
    map.set(obs.sessionCode, list)
  })
  const views: SessionView[] = []
  map.forEach((rows, code) => {
    views.push({
      sessionCode: code,
      obsDate: rows[0]?.obsDate ?? null,
      dateSource: rows[0]?.dateSource ?? 'dated',
      rows: rows.length,
      overLimit: rows.filter((obs) => {
        const point = points.get(obs.pointCode)
        return !!point && isOverLimit(ratioOf(obs.dx, obs.dy, point.allowable))
      }).length,
      migrated: rows.every((row) => row.migrated),
      importId: rows[0]?.importId ?? null,
    })
  })
  return views.sort((a, b) => {
    if (a.dateSource !== b.dateSource) return a.dateSource === 'paper' ? -1 : 1
    if (a.obsDate && b.obsDate && a.obsDate !== b.obsDate) return a.obsDate < b.obsDate ? -1 : 1
    return a.sessionCode.localeCompare(b.sessionCode)
  })
}

export interface MonthlyOverlimit {
  month: string
  pointCode: string
  sessionCode: string
  obsDate: string
  resultantMm: number
  allowable: number
  ratio: number
}

/** 监测月报：只汇总有确切日期的超限观测；纸档待核不进月份统计。 */
export function monthlyOverlimits(): MonthlyOverlimit[] {
  const { state } = getLedger()
  const points = pointMap(state)
  const rows: MonthlyOverlimit[] = []
  state.observations.forEach((obs) => {
    const point = points.get(obs.pointCode)
    if (!point || !obs.obsDate || obs.dateSource === 'paper') return
    const ratio = ratioOf(obs.dx, obs.dy, point.allowable)
    if (isOverLimit(ratio)) {
      rows.push({
        month: obs.obsDate.slice(0, 7),
        pointCode: obs.pointCode,
        sessionCode: obs.sessionCode,
        obsDate: obs.obsDate,
        resultantMm: round1(resultant(obs.dx, obs.dy)),
        allowable: point.allowable,
        ratio: roundRatio(ratio),
      })
    }
  })
  return rows.sort((a, b) => (a.obsDate < b.obsDate ? 1 : -1))
}

/** 值班入口看到的待办：开放且未被新版本判陈旧的（备品备件页与值班页读同一份）。 */
export function openTodos(): TodoItem[] {
  return getLedger()
    .state.todos.filter((todo) => todo.status === 'open' && !todo.stale)
    .sort((a, b) => {
      const da = a.obsDate ?? ''
      const db = b.obsDate ?? ''
      return da === db ? b.id - a.id : da < db ? 1 : -1
    })
}

export function allTodos(): TodoItem[] {
  return getLedger()
    .state.todos.slice()
    .sort((a, b) => b.id - a.id)
}

export function listRejections(sessionCode?: string): RejectedRow[] {
  return getLedger()
    .state.rejections.filter((row) => !sessionCode || row.sessionCode === sessionCode)
    .sort((a, b) => b.id - a.id)
}

export function listImports(): ImportBatch[] {
  return getLedger()
    .state.imports.slice()
    .sort((a, b) => b.id - a.id)
}

export function listPoints(): Point[] {
  return getLedger()
    .state.points.slice()
    .sort((a, b) => a.code.localeCompare(b.code))
}

const EXPORT_COLUMNS = [
  '测次',
  '测点编号',
  '测点高程(m)',
  '观测日期',
  '日期来源',
  '水平位移(mm)',
  '垂直位移(mm)',
  '累计位移(mm)',
  '允许位移(mm)',
  '占允许位移比例',
  '超限标记',
]

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 导出观测成果：累计位移与超限标记就在上面同一套函数里算，与页面同属一份。 */
export function exportObservationsCsv(): { filename: string; content: string } {
  const { state } = getLedger()
  const points = pointMap(state)
  const lines = [EXPORT_COLUMNS.join(',')]
  const ordered = state.observations.slice().sort((a, b) => {
    if (a.dateSource !== b.dateSource) return a.dateSource === 'paper' ? -1 : 1
    const da = a.obsDate ?? ''
    const db = b.obsDate ?? ''
    if (da !== db) return da < db ? -1 : 1
    if (a.sessionCode !== b.sessionCode) return a.sessionCode < b.sessionCode ? -1 : 1
    return a.pointCode.localeCompare(b.pointCode)
  })
  ordered.forEach((obs) => {
    const point = points.get(obs.pointCode)
    if (!point) return
    const ratio = ratioOf(obs.dx, obs.dy, point.allowable)
    lines.push(
      [
        obs.sessionCode,
        obs.pointCode,
        obs.elevation,
        obs.obsDate ?? '',
        obs.dateSource === 'paper' ? '纸档待核' : '观测日期',
        obs.dx,
        obs.dy,
        round1(resultant(obs.dx, obs.dy)),
        point.allowable,
        Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : '',
        isOverLimit(ratio) ? '超限' : '正常',
      ]
        .map(csvCell)
        .join(','),
    )
  })
  return {
    filename: `位移观测成果-${new Date().toISOString().slice(0, 10)}.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

/** 月报导出（值班入口用）。 */
export function exportMonthlyCsv(): { filename: string; content: string } {
  const rows = monthlyOverlimits()
  const header = ['月份', '测点编号', '测次', '观测日期', '累计位移(mm)', '允许位移(mm)', '占比', '超限标记']
  const lines = [header.join(',')]
  rows.forEach((row) => {
    lines.push(
      [
        row.month,
        row.pointCode,
        row.sessionCode,
        row.obsDate,
        row.resultantMm,
        row.allowable,
        `${(row.ratio * 100).toFixed(1)}%`,
        '超限',
      ]
        .map(csvCell)
        .join(','),
    )
  })
  return { filename: `位移超限月报-${new Date().toISOString().slice(0, 10)}.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadFile(file: { filename: string; content: string }): void {
  const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 测试与运维用：清空并重新迁移。 */
export function resetLedger(): LedgerState {
  const fresh = emptyState()
  runMigration(fresh)
  persist(fresh)
  return fresh
}
