import { addAudit, db, genId, nowStamp, transaction } from './store'
import {
  ELEVATION_TOLERANCE_M,
  calcCumulative,
  calcRatio,
  isOverLimit,
  monthOf,
  parseNumber,
  parseObservedDate,
  roundOrder,
  round1,
  sortKey,
} from './calc'
import { fieldOf, parseImportText, type ParsedImport } from './parser'
import type {
  AlertRecord,
  AuditEntry,
  DisplacementPoint,
  ImportBatch,
  ObservationRow,
  RejectRow,
  TodoItem,
} from './types'

// ---------------------------------------------------------------------------
// 查询：三个入口共用同一份数据
// ---------------------------------------------------------------------------

export function liveObservations(): ObservationRow[] {
  return db()
    .observations.filter((row) => !row.replaced)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

export function rounds(): { roundNo: string; observedAt: string | null; count: number }[] {
  const map = new Map<string, { roundNo: string; observedAt: string | null; count: number }>()
  for (const row of liveObservations()) {
    const item = map.get(row.roundNo) ?? {
      roundNo: row.roundNo,
      observedAt: row.observedAt,
      count: 0,
    }
    item.count += 1
    map.set(row.roundNo, item)
  }
  return [...map.values()].sort(
    (a, b) => sortKey({ observedAt: a.observedAt, roundNo: a.roundNo, pointCode: '' }).localeCompare(
      sortKey({ observedAt: b.observedAt, roundNo: b.roundNo, pointCode: '' }),
    ),
  )
}

export function pointByCode(code: string): DisplacementPoint | undefined {
  return db().points.find((item) => item.code === code)
}

export function openAlerts(): AlertRecord[] {
  return db()
    .alerts.filter((item) => item.status === 'open')
    .sort((a, b) => sortKey({ observedAt: a.observedAt, roundNo: a.roundNo, pointCode: a.pointCode }).localeCompare(
      sortKey({ observedAt: b.observedAt, roundNo: b.roundNo, pointCode: b.pointCode }),
    ))
}

export function alertsOfMonth(month: string | null): AlertRecord[] {
  return db()
    .alerts.filter((item) => item.status === 'open' && monthOf(item.observedAt) === month)
    .sort((a, b) => sortKey({ observedAt: a.observedAt, roundNo: a.roundNo, pointCode: a.pointCode }).localeCompare(
      sortKey({ observedAt: b.observedAt, roundNo: b.roundNo, pointCode: b.pointCode }),
    ))
}

export function openTodos(): TodoItem[] {
  return db()
    .todos.filter((item) => item.status === '待办')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function todosOfMonth(month: string | null): TodoItem[] {
  return openTodos()
    .filter((item) => (item.kind === '位移超限处置' ? item.month === month : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 月报可选月份：有观测日期的月份 + 无日期桶(null) */
export function reportMonths(): string[] {
  const set = new Set<string>()
  for (const row of liveObservations()) {
    if (row.observedAt) {
      set.add(row.observedAt.slice(0, 7))
    }
  }
  return [...set].sort().reverse()
}

export function auditLog(): AuditEntry[] {
  return [...db().audit].sort((a, b) => b.at.localeCompare(a.at))
}

export function rejectLog(): RejectRow[] {
  return [...db().rejects].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export function batches(): ImportBatch[] {
  return [...db().batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

// ---------------------------------------------------------------------------
// 导入：逐行核对（测点编号 / 测点高程 / 观测日期），先预览（不写库），确认后整笔提交
// ---------------------------------------------------------------------------

export type PreviewAccepted = {
  lineNo: number
  rawLine: string
  roundNo: string
  pointCode: string
  elevationObserved: number
  dx: number
  dy: number
  observedAt: string | null
  dateInferred: boolean
  allowable: number
  cumulative: number
  ratio: number
  overLimit: boolean
  /** 同测次同测点本次文件里的重复登记：保留第一次，此行不入库只留痕 */
  duplicate: boolean
}

export type PreviewRejected = {
  lineNo: number
  rawLine: string
  roundNo: string
  pointCode: string
  reason: string
  duplicate: boolean
}

export type ImportPreview = {
  fileName: string
  parsed: ParsedImport
  accepted: PreviewAccepted[]
  rejected: PreviewRejected[]
  touchedRounds: string[]
}

export function previewImport(text: string, fileName: string): ImportPreview {
  const parsed = parseImportText(text)
  const accepted: PreviewAccepted[] = []
  const rejected: PreviewRejected[] = []
  // 本次文件内（测次+测点）去重：重复登记只认第一次
  const seen = new Set<string>()

  for (const row of parsed.rows) {
    const roundNo = fieldOf(parsed, row, 'roundNo').trim()
    const pointCode = fieldOf(parsed, row, 'pointCode').trim().toUpperCase()
    const elevationRaw = fieldOf(parsed, row, 'elevationObserved')
    const dxRaw = fieldOf(parsed, row, 'dx')
    const dyRaw = fieldOf(parsed, row, 'dy')
    const dateRaw = fieldOf(parsed, row, 'observedAt')

    const reject = (reason: string, duplicate = false) =>
      rejected.push({ lineNo: row.lineNo, rawLine: row.rawLine, roundNo, pointCode, reason, duplicate })

    if (!roundNo) {
      reject('测次编号为空，无法归属测次')
      continue
    }
    if (!pointCode) {
      reject('测点编号为空')
      continue
    }
    const point = pointByCode(pointCode)
    if (!point) {
      reject(`测点编号 ${pointCode} 未在测点台账登记`)
      continue
    }

    const elevationObserved = parseNumber(elevationRaw)
    if (elevationObserved === null) {
      reject(`测点高程「${elevationRaw}」不是数值`)
      continue
    }
    if (Math.abs(elevationObserved - point.elevation) > ELEVATION_TOLERANCE_M) {
      reject(
        `测点高程 ${elevationObserved.toFixed(2)}m 与台账高程 ${point.elevation.toFixed(
          2,
        )}m 不符（超出 ±${ELEVATION_TOLERANCE_M}m 容差）`,
      )
      continue
    }

    const dx = parseNumber(dxRaw)
    if (dx === null) {
      reject(`水平位移「${dxRaw}」不是数值`)
      continue
    }
    const dy = parseNumber(dyRaw)
    if (dy === null) {
      reject(`垂直位移「${dyRaw}」不是数值`)
      continue
    }

    const dateResult = parseObservedDate(dateRaw)
    if (dateResult.error) {
      reject(dateResult.error)
      continue
    }

    const key = `${roundNo}|${pointCode}`
    const duplicate = seen.has(key)
    if (duplicate) {
      reject(`测次 ${roundNo} 测点 ${pointCode} 重复登记：只认第一次取值，此行保留留痕不覆盖`, true)
    } else {
      seen.add(key)
    }

    const cumulative = calcCumulative(dx, dy)
    accepted.push({
      lineNo: row.lineNo,
      rawLine: row.rawLine,
      roundNo,
      pointCode,
      elevationObserved,
      dx,
      dy,
      observedAt: dateResult.date,
      dateInferred: dateResult.date === null,
      allowable: point.allowable,
      cumulative,
      ratio: calcRatio(cumulative, point.allowable),
      overLimit: isOverLimit(cumulative, point.allowable),
      duplicate,
    })
  }

  const touchedRounds = [...new Set(accepted.filter((item) => !item.duplicate).map((item) => item.roundNo))]

  return { fileName, parsed, accepted, rejected, touchedRounds }
}

export type CommitResult = {
  batches: ImportBatch[]
  acceptedCount: number
  rejectedCount: number
  duplicateCount: number
}

/**
 * 确认导入：一个事务里完成
 *  - 同一测次重复导入：旧版整笔 replaced 留痕，以最后一次为准（不是叠加）；
 *  - 同测次同测点重复行：第一次取值入库，其余进另册；
 *  - 累计位移/超限重算，超限记录与待办联动；校验不过的行另册写清缘由。
 */
export function commitImport(preview: ImportPreview, actor: string): CommitResult {
  const realAccepted = preview.accepted.filter((item) => !item.duplicate)
  if (realAccepted.length === 0) {
    throw new Error('没有可入库的观测行：整笔退回，未写入任何记录')
  }

  return transaction((draft) => {
    const now = nowStamp()
    const createdBatches: ImportBatch[] = []
    const acceptedByRound = new Map<string, PreviewAccepted[]>()
    for (const item of realAccepted) {
      const list = acceptedByRound.get(item.roundNo) ?? []
      list.push(item)
      acceptedByRound.set(item.roundNo, list)
    }

    for (const [roundNo, items] of acceptedByRound) {
      // 旧版本：整测作废留痕（观测行 replaced，旧批次被新批次取代）
      const oldLive = draft.observations.filter((row) => !row.replaced && row.roundNo === roundNo)
      const firstSeenByPoint = new Map<string, string>()
      for (const old of oldLive) {
        old.replaced = true
        old.updatedAt = now
        firstSeenByPoint.set(old.pointCode, old.firstSeenAt)
      }
      const oldBatch = [...draft.batches]
        .filter((batch) => batch.roundNo === roundNo && !batch.id.startsWith('B-LEG'))
        .sort((a, b) => b.seq - a.seq)[0]
      const seq = draft.batches.filter((batch) => batch.roundNo === roundNo).length
      const legacyReplaced = draft.batches.find((batch) => batch.id === 'B-LEGACY' && batch.roundNo.includes(roundNo))

      const batch: ImportBatch = {
        id: genId('B', draft.batches),
        roundNo,
        seq,
        fileName: preview.fileName,
        importedAt: now,
        acceptedCount: items.length,
        rejectedCount: preview.rejected.filter((item) => item.roundNo === roundNo).length,
        duplicateCount: preview.rejected.filter((item) => item.roundNo === roundNo && item.duplicate).length,
        replacedBatchId: oldBatch?.id ?? (legacyReplaced ? legacyReplaced.id : null),
        note: oldLive.length
          ? `同一测次第 ${seq + 1} 次导入：覆盖上一版 ${oldLive.length} 行（旧版留痕，不叠加）`
          : `首次导入测次 ${roundNo}`,
      }
      draft.batches.push(batch)
      createdBatches.push(batch)

      for (const item of items) {
        const point = draft.points.find((p) => p.code === item.pointCode)!
        const cumulative = calcCumulative(item.dx, item.dy)
        const row: ObservationRow = {
          id: genId('O', draft.observations),
          batchId: batch.id,
          roundNo,
          pointCode: item.pointCode,
          elevationObserved: item.elevationObserved,
          dx: item.dx,
          dy: item.dy,
          observedAt: item.observedAt,
          dateInferred: item.dateInferred,
          source: 'import',
          // 重复导入只认第一次取值——首次入库时间沿用旧版
          firstSeenAt: firstSeenByPoint.get(item.pointCode) ?? now,
          updatedAt: now,
          replaced: false,
          cumulative,
          ratio: calcRatio(cumulative, point.allowable),
          overLimit: isOverLimit(cumulative, point.allowable),
        }
        draft.observations.push(row)
      }

      reconcileRound(draft, roundNo, now, actor, batch.id)
    }

    // 校验另册 + 重复登记另册（每一行写清缘由）
    for (const item of preview.rejected) {
      draft.rejects.push({
        id: genId('R', draft.rejects),
        batchId: createdBatches.find((batch) => batch.roundNo === item.roundNo)?.id ?? createdBatches[0].id,
        roundNo: item.roundNo,
        pointCode: item.pointCode,
        rawLine: item.rawLine,
        reason: item.reason,
        category: item.duplicate ? '重复登记' : '校验未过',
        occurredAt: now,
      })
    }

    const dupCount = preview.rejected.filter((item) => item.duplicate).length
    addAudit(
      draft,
      actor,
      '导入观测成果',
      `文件「${preview.fileName}」入库 ${realAccepted.length} 行、另册 ${preview.rejected.length} 行` +
        `（其中重复登记 ${dupCount} 行，只认第一次取值）；涉及测次 ${[...acceptedByRound.keys()].join('、')}，` +
        `同测次旧版整笔覆盖留痕；累计位移与超限标记由系统重算。`,
      createdBatches[0].id,
    )

    return {
      batches: createdBatches,
      acceptedCount: realAccepted.length,
      rejectedCount: preview.rejected.length,
      duplicateCount: dupCount,
    }
  })
}

/** 单个测次的超限记录 / 待办对账：以当前现行观测行为准，不允许出现“只在位移页面标一下” */
function reconcileRound(
  draft: ReturnType<typeof db>,
  roundNo: string,
  now: string,
  actor: string,
  batchId: string,
): void {
  const rows = draft.observations.filter((row) => !row.replaced && row.roundNo === roundNo)

  // 该测次原有的未关闭超限记录与待办：整测重算，旧的关闭留痕
  const oldOpenAlerts = draft.alerts.filter((a) => a.roundNo === roundNo && a.status === 'open')
  for (const alert of oldOpenAlerts) {
    alert.status = 'closed'
    alert.closedAt = now
    alert.closedReason = `测次 ${roundNo} 重新导入，以最后一次为准，旧超限结论作废留痕`
    const linked = draft.todos.filter((todo) => todo.refType === 'alert' && todo.refId === alert.id && todo.status === '待办')
    for (const todo of linked) {
      todo.status = '已办'
      todo.doneAt = now
      todo.handledBy = actor
      todo.handleNote = '同测次重新导入，超限记录重算，旧待办随旧结论关闭'
    }
  }

  for (const row of rows) {
    if (!row.overLimit) {
      continue
    }
    const point = draft.points.find((p) => p.code === row.pointCode)
    const alert: AlertRecord = {
      id: genId('A', draft.alerts),
      pointCode: row.pointCode,
      roundNo,
      observedAt: row.observedAt,
      dateInferred: row.dateInferred,
      cumulative: row.cumulative,
      allowable: point?.allowable ?? 0,
      ratio: row.ratio,
      batchId,
      openedAt: now,
      status: 'open',
      closedAt: null,
      closedReason: null,
    }
    draft.alerts.push(alert)

    const todo: TodoItem = {
      id: genId('T', draft.todos),
      kind: '位移超限处置',
      refType: 'alert',
      refId: alert.id,
      title: `${row.pointCode} ${roundNo} 累计位移 ${row.cumulative}mm 超过允许 ${point?.allowable ?? 0}mm（${row.ratio}%）`,
      detail: `水平 ${row.dx}mm / 垂直 ${row.dy}mm` +
        (row.observedAt ? `，观测日期 ${row.observedAt}` : '，观测日期缺失待补录') +
        '，已写入监测月报，请安排复核处置。',
      pointCode: row.pointCode,
      roundNo,
      month: monthOf(row.observedAt),
      createdAt: now,
      status: '待办',
      doneAt: null,
      handledBy: null,
      handleNote: null,
    }
    draft.todos.push(todo)
  }

  // 观测日期缺失：每个测次挂一条补录待办；已有待办则不重复
  const missingRows = rows.filter((row) => row.observedAt === null)
  if (missingRows.length > 0) {
    const exists = draft.todos.some(
      (todo) => todo.kind === '观测日期补录' && todo.roundNo === roundNo && todo.status === '待办',
    )
    if (!exists) {
      draft.todos.push({
        id: genId('T', draft.todos),
        kind: '观测日期补录',
        refType: 'round',
        refId: roundNo,
        title: `${roundNo} 有 ${missingRows.length} 行观测日期缺失（纸质记录推定排序）`,
        detail: '按测次发生顺序推定排在早期，请凭纸质手簿补录观测日期，补录后自动归入正确月份。',
        pointCode: [...new Set(missingRows.map((row) => row.pointCode))].join('/'),
        roundNo,
        month: null,
        createdAt: now,
        status: '待办',
        doneAt: null,
        handledBy: null,
        handleNote: null,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 观测日期补录（纸质记录补录）：只改日期，水平/垂直原值保持原样；月份联动月报与待办
// ---------------------------------------------------------------------------

export function backfillRoundDate(roundNo: string, dateRaw: string, actor: string): void {
  const result = parseObservedDate(dateRaw)
  if (result.error || !result.date) {
    throw new Error(result.error ?? '观测日期无效，整笔退回')
  }
  const confirmedDate = result.date
  transaction((draft) => {
    const rows = draft.observations.filter((row) => !row.replaced && row.roundNo === roundNo)
    if (rows.length === 0) {
      throw new Error(`没有现行的测次 ${roundNo}`)
    }
    for (const row of rows) {
      row.observedAt = confirmedDate
      row.dateInferred = false
      row.updatedAt = nowStamp()
    }
    for (const alert of draft.alerts.filter((a) => a.roundNo === roundNo)) {
      alert.observedAt = confirmedDate
      alert.dateInferred = false
    }
    for (const todo of draft.todos) {
      if (todo.roundNo === roundNo) {
        if (todo.kind === '位移超限处置') {
          todo.month = confirmedDate.slice(0, 7)
        }
        if (todo.kind === '观测日期补录' && todo.status === '待办') {
          todo.status = '已办'
          todo.doneAt = nowStamp()
          todo.handledBy = actor
          todo.handleNote = `凭纸质手簿补录观测日期 ${confirmedDate}`
        }
      }
    }
    addAudit(draft, actor, '补录观测日期', `测次 ${roundNo} 凭纸质记录补录观测日期为 ${confirmedDate}，超限记录同步归入该月。`)
  })
}

// ---------------------------------------------------------------------------
// 待办处置（备品备件页/月报同一入口同一份）
// ---------------------------------------------------------------------------

export function resolveTodo(todoId: string, note: string, actor: string): void {
  transaction((draft) => {
    const todo = draft.todos.find((item) => item.id === todoId)
    if (!todo) {
      throw new Error('待办不存在')
    }
    if (todo.status === '已办') {
      throw new Error('该待办已处置')
    }
    todo.status = '已办'
    todo.doneAt = nowStamp()
    todo.handledBy = actor
    todo.handleNote = note.trim() || '现场已处置'
    if (todo.refType === 'alert') {
      const alert = draft.alerts.find((item) => item.id === todo.refId)
      if (alert && alert.status === 'open') {
        alert.status = 'closed'
        alert.closedAt = todo.doneAt
        alert.closedReason = todo.handleNote
      }
    }
    addAudit(draft, actor, '处置业务待办', `${todo.kind}：${todo.title}（${todo.handleNote}）`)
  })
}

// ---------------------------------------------------------------------------
// 测点台账维护：改允许位移后，累计比例与超限记录全量重算，台账与业务清单一起变
// ---------------------------------------------------------------------------

function recalcAll(draft: ReturnType<typeof db>): void {
  for (const row of draft.observations) {
    if (row.replaced) {
      continue
    }
    const point = draft.points.find((p) => p.code === row.pointCode)
    const allowable = point?.allowable ?? 0
    row.cumulative = calcCumulative(row.dx, row.dy)
    row.ratio = calcRatio(row.cumulative, allowable)
    row.overLimit = isOverLimit(row.cumulative, allowable)
  }
}

export function savePoint(input: {
  id?: string
  code: string
  section: string
  elevation: number
  allowable: number
}, actor: string): void {
  const code = input.code.trim().toUpperCase()
  if (!code) {
    throw new Error('测点编号不能为空')
  }
  if (!Number.isFinite(input.elevation)) {
    throw new Error('测点高程必须是数值')
  }
  if (!Number.isFinite(input.allowable) || input.allowable <= 0) {
    throw new Error('允许位移必须是正数')
  }
  transaction((draft) => {
    const now = nowStamp()
    const existing = input.id ? draft.points.find((p) => p.id === input.id) : undefined
    const duplicated = draft.points.some((p) => p.code === code && p.id !== input.id)
    if (duplicated) {
      throw new Error(`测点编号 ${code} 已存在`)
    }
    if (existing) {
      existing.code = code
      existing.section = input.section.trim()
      existing.elevation = round1(input.elevation)
      existing.allowable = round1(input.allowable)
      existing.updatedAt = now
    } else {
      draft.points.push({
        id: genId('P', draft.points),
        code,
        section: input.section.trim(),
        elevation: round1(input.elevation),
        allowable: round1(input.allowable),
        createdAt: now,
        updatedAt: now,
      })
    }
    recalcAll(draft)
    // 允许位移变化后按测点精确重对账超限记录与待办（同一事务，台账与清单一起变）
    reconcilePointChange(draft, now, actor)
    addAudit(draft, actor, existing ? '修改测点台账' : '新增测点台账', `${code} 高程 ${input.elevation}m、允许位移 ${input.allowable}mm；累计比例与超限记录已重算。`)
  })
}

/** 测点参数变更后的全量精确对账：已恢复正常的关闭留痕，数值变化刷新，新超限才开单 */
function reconcilePointChange(draft: ReturnType<typeof db>, now: string, actor: string): void {
  const liveRow = (roundNo: string, pointCode: string) =>
    draft.observations.find((row) => !row.replaced && row.roundNo === roundNo && row.pointCode === pointCode)

  // 1) 现有未关闭超限记录：按最新现行观测行刷新或关闭
  for (const alert of draft.alerts.filter((item) => item.status === 'open')) {
    const row = liveRow(alert.roundNo, alert.pointCode)
    if (!row || !row.overLimit) {
      alert.status = 'closed'
      alert.closedAt = now
      alert.closedReason = '测点允许位移调整后累计位移回到允许范围内，超限解除'
      for (const todo of draft.todos.filter((item) => item.refType === 'alert' && item.refId === alert.id && item.status === '待办')) {
        todo.status = '已办'
        todo.doneAt = now
        todo.handledBy = actor
        todo.handleNote = alert.closedReason
      }
    } else {
      const point = draft.points.find((p) => p.code === row.pointCode)
      alert.cumulative = row.cumulative
      alert.allowable = point?.allowable ?? 0
      alert.ratio = row.ratio
    }
  }

  // 2) 新超限：当前现行行超限、且没有未关闭超限记录的，开单并写月报/待办
  const openKeys = new Set(
    draft.alerts.filter((item) => item.status === 'open').map((item) => `${item.roundNo}|${item.pointCode}`),
  )
  for (const row of draft.observations.filter((item) => !item.replaced && item.overLimit)) {
    if (openKeys.has(`${row.roundNo}|${row.pointCode}`)) {
      continue
    }
    const point = draft.points.find((p) => p.code === row.pointCode)
    const alert: AlertRecord = {
      id: genId('A', draft.alerts),
      pointCode: row.pointCode,
      roundNo: row.roundNo,
      observedAt: row.observedAt,
      dateInferred: row.dateInferred,
      cumulative: row.cumulative,
      allowable: point?.allowable ?? 0,
      ratio: row.ratio,
      batchId: row.batchId,
      openedAt: now,
      status: 'open',
      closedAt: null,
      closedReason: null,
    }
    draft.alerts.push(alert)
    draft.todos.push({
      id: genId('T', draft.todos),
      kind: '位移超限处置',
      refType: 'alert',
      refId: alert.id,
      title: `${row.pointCode} ${row.roundNo} 累计位移 ${row.cumulative}mm 超过允许 ${point?.allowable ?? 0}mm（${row.ratio}%）`,
      detail: `测点允许位移调整后重新判定为超限；水平 ${row.dx}mm / 垂直 ${row.dy}mm，已写入监测月报。`,
      pointCode: row.pointCode,
      roundNo: row.roundNo,
      month: monthOf(row.observedAt),
      createdAt: now,
      status: '待办',
      doneAt: null,
      handledBy: null,
      handleNote: null,
    })
  }
}

// ---------------------------------------------------------------------------
// 导出：与页面同源，另存的累计位移列与超限标记必然对得上
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const EXPORT_HEADERS = [
  '测次编号', '测点编号', '测点部位', '观测高程(m)', '台账高程(m)',
  '水平位移(mm)', '垂直位移(mm)', '累计位移(mm)', '允许位移(mm)',
  '占允许位移比例(%)', '观测日期', '日期推定', '超限标记', '首次入库时间',
]

export function exportObservations(roundNo?: string): { filename: string; content: string } {
  const rows = liveObservations().filter((row) => !roundNo || row.roundNo === roundNo)
  const lines = [EXPORT_HEADERS.join(',')]
  for (const row of rows) {
    const point = pointByCode(row.pointCode)
    lines.push(
      [
        row.roundNo,
        row.pointCode,
        point?.section ?? '',
        row.elevationObserved,
        point?.elevation ?? '',
        row.dx,
        row.dy,
        row.cumulative,
        point?.allowable ?? '',
        row.ratio === Number.POSITIVE_INFINITY ? '∞' : row.ratio,
        row.observedAt ?? '日期缺失',
        row.dateInferred ? '是（推定）' : '否',
        row.overLimit ? '超限' : '正常',
        row.firstSeenAt,
      ].map(csvCell).join(','),
    )
  }
  return {
    filename: `位移观测成果-${roundNo ?? '全部测次'}.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

export function exportRejects(): { filename: string; content: string } {
  const headers = ['批次', '测次编号', '测点编号', '类别', '缘由', '原始行', '时间']
  const lines = [headers.join(',')]
  for (const row of rejectLog()) {
    lines.push(
      [row.batchId, row.roundNo, row.pointCode, row.category, row.reason, row.rawLine, row.occurredAt]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '位移观测校验另册.csv', content: `﻿${lines.join('\n')}` }
}

export function importTemplate(): { filename: string; content: string } {
  const content = [
    '测次编号,测点编号,测点高程,水平位移,垂直位移,观测日期',
    'R04,DISP-01,845.00,15.2,-10.4,2026-10-05',
    'R04,DISP-02,846.50,11.0,8.6,2026-10-05',
    'R04,DISP-03,812.30,9.8,-6.5,2026-10-05',
  ].join('\n')
  return { filename: '位移观测成果导入模板.csv', content: `﻿${content}` }
}

export function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 供测点维护表单/统计复用
export { roundOrder }

// 视图统一从 service 取数，store 的只读库也从这里转出
export { db }
