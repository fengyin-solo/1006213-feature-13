/** 外业观测成果文本解析。
 * 只负责「逐行拆开、对列认字段」；与测点台账的逐行核对在 store 里做。
 * 兼容逗号/Tab/多空格分隔、表头别名、测次抬头，以及外业常见的列顺序。 */

export type FieldKey = 'code' | 'elevation' | 'date' | 'dx' | 'dy' | 'cum'

const FIELD_ALIASES: Record<Exclude<FieldKey, 'cum'>, string[]> = {
  code: ['测点编号', '点号', '测点号', '测点', '编号'],
  elevation: ['测点高程', '高程', '标高'],
  date: ['观测日期', '监测日期', '观测时间', '日期'],
  dx: ['水平位移', '水平位移量', '水平', 'dx', 'DX'],
  dy: ['垂直位移', '沉降位移', '沉降量', '垂直', '沉降', 'dy', 'DY'],
}

// 累计位移列：认得出但不使用，文件里手填的累计值一律忽略重算。
const CUM_ALIASES = ['累计位移', '累计位移量', '累计', '合位移', '合成位移']

// 无表头时的兜底列序（外业最常见的排法，日期在最后）。
const FALLBACK_ORDER: FieldKey[] = ['code', 'elevation', 'dx', 'dy', 'date']

export interface ParsedLine {
  lineNo: number
  rawLine: string
  /** 是否构成一条数据行；false 时 reason 写明为何忽略或拒收 */
  dataLine: boolean
  byKey: Partial<Record<FieldKey, string>>
  cellCount: number
  reason: string | null
}

export interface ParsedFile {
  /** 文件抬头里写的测次号（可空，由用户在导入框补） */
  sessionFromFile: string | null
  headerDate: string | null
  headerDetected: boolean
  /** 文件中出现了手填累计列（留痕用） */
  cumulativeColumnDetected: boolean
  lines: ParsedLine[]
}

// 认不出的表头列也占一个位置，保证后续各列不错位。
const UNKNOWN: unique symbol = Symbol('unknown-column')
type ColumnKey = FieldKey | typeof UNKNOWN

// 逗号/分号/Tab 是「有位置」的分隔符，空单元格保留，保证各列不错位；
// 纯空格分隔（固定宽度外业表）没有空列概念，连续空格合并。
function splitCells(line: string): string[] {
  const cleaned = line.replace(/^﻿/, '')
  if (/[\t,，;；]/.test(cleaned)) {
    return cleaned.split(/[\t,，;；]/).map((cell) => cell.trim())
  }
  return cleaned.split(/\s+/).filter((cell) => cell !== '')
}

function matchAlias(cell: string): FieldKey | null {
  const compact = cell.replace(/[\s()（）:：]/g, '').toLowerCase()
  for (const key of ['code', 'elevation', 'date', 'dx', 'dy'] as const) {
    if (FIELD_ALIASES[key].some((alias) => compact === alias.toLowerCase())) {
      return key
    }
  }
  if (CUM_ALIASES.some((alias) => compact === alias.toLowerCase())) {
    return 'cum'
  }
  return null
}

function extractDirective(line: string): { type: 'session' | 'date'; value: string } | null {
  const session = line.match(/测\s*次(?:号|编号)?\s*[:：]\s*(.+)$/)
  if (session) return { type: 'session', value: session[1].trim() }
  const date = line.match(/(?:观测|监测)\s*日期\s*[:：]\s*(.+)$/)
  if (date) return { type: 'date', value: date[1].trim() }
  return null
}

function looksLikePointCode(cell: string | undefined): boolean {
  return !!cell && /^[A-Za-z0-9][A-Za-z0-9\-_/]*\d/.test(cell)
}

export function parseFieldText(rawText: string): ParsedFile {
  const result: ParsedFile = {
    sessionFromFile: null,
    headerDate: null,
    headerDetected: false,
    cumulativeColumnDetected: false,
    lines: [],
  }
  // 位置列序：表头出现后按表头映射，之前用兜底列序。无法识别的列占位列，保证不错位。
  let columnOrder: ColumnKey[] = [...FALLBACK_ORDER]

  const textLines = rawText.replace(/^﻿/, '').split(/\r?\n/)
  textLines.forEach((raw, index) => {
    const lineNo = index + 1
    const line = raw.trim()
    if (!line) return

    const directive = extractDirective(line)
    if (directive) {
      if (directive.type === 'session' && !result.sessionFromFile) {
        result.sessionFromFile = directive.value
      }
      if (directive.type === 'date' && !result.headerDate) {
        result.headerDate = directive.value
      }
      return
    }

    const cells = splitCells(line)

    // 表头行：必须出现「测点编号」列别名，且另有一个字段别名；
    // 数字单元格（高程/位移读数）不会被当表头，避免 4 列数据行被误判。
    const aliasHits = cells.map((cell) => matchAlias(cell))
    const distinctFields = new Set(aliasHits.filter((key) => key !== null))
    if (cells.length >= 2 && distinctFields.has('code') && distinctFields.size >= 2) {
      columnOrder = aliasHits.map((key) => key ?? UNKNOWN)
      result.headerDetected = true
      if (columnOrder.includes('cum')) result.cumulativeColumnDetected = true
      return
    }

    const byKey: Partial<Record<FieldKey, string>> = {}
    cells.forEach((cell, i) => {
      const key = columnOrder[i]
      if (key && key !== UNKNOWN) byKey[key] = cell
    })

    // 认不出列时按兜底列序再试一次（文件全程无表头的情形）。
    if (!result.headerDetected) {
      const fallbackByKey: Partial<Record<FieldKey, string>> = {}
      cells.forEach((cell, i) => {
        const key = FALLBACK_ORDER[i]
        if (key) fallbackByKey[key] = cell
      })
      if (looksLikePointCode(fallbackByKey.code)) {
        result.lines.push({
          lineNo,
          rawLine: line,
          dataLine: true,
          byKey: fallbackByKey,
          cellCount: cells.length,
          reason: null,
        })
        return
      }
    }

    if (!looksLikePointCode(byKey.code)) {
      result.lines.push({
        lineNo,
        rawLine: line,
        dataLine: false,
        byKey,
        cellCount: cells.length,
        reason: '无法识别的行（既不是表头/测次抬头，也读不出测点编号）',
      })
      return
    }

    const required: FieldKey[] = ['elevation', 'dx', 'dy']
    const missing = required.filter((key) => byKey[key] === undefined || byKey[key] === '')
    if (missing.length) {
      const label: Record<string, string> = { elevation: '测点高程', dx: '水平位移', dy: '垂直位移' }
      result.lines.push({
        lineNo,
        rawLine: line,
        dataLine: false,
        byKey,
        cellCount: cells.length,
        reason: `列数不足，缺${missing.map((key) => label[key]).join('、')}（本行 ${cells.length} 列）`,
      })
      return
    }

    result.lines.push({
      lineNo,
      rawLine: line,
      dataLine: true,
      byKey,
      cellCount: cells.length,
      reason: null,
    })
  })

  return result
}
