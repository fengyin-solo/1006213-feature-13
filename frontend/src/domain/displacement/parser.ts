/** 外业观测成果文本解析：支持 CSV、制表符、中文逗号/空白分隔，容错不挑手簿格式。 */

export type RawFieldRow = {
  lineNo: number
  rawLine: string
  cells: string[]
}

/** 表头列名 -> 标准字段 */
const HEADER_ALIASES: Record<string, string> = {
  测次: 'roundNo',
  测次编号: 'roundNo',
  期次: 'roundNo',
  round: 'roundNo',
  测点编号: 'pointCode',
  测点: 'pointCode',
  点号: 'pointCode',
  测点高程: 'elevationObserved',
  高程: 'elevationObserved',
  水平位移: 'dx',
  水平: 'dx',
  垂直位移: 'dy',
  垂直: 'dy',
  观测日期: 'observedAt',
  日期: 'observedAt',
  观测时间: 'observedAt',
}

/** 无表头时的固定列序（外业队最常见的手簿列） */
export const FALLBACK_COLUMNS = [
  'roundNo',
  'pointCode',
  'elevationObserved',
  'dx',
  'dy',
  'observedAt',
] as const

export type ParsedImport = {
  header: string[] | null
  rows: RawFieldRow[]
}

function splitLine(line: string): string[] {
  // 先按制表符切；没有制表符再按中文逗号/英文逗号/连续空白切
  if (line.includes('\t')) {
    return line.split('\t').map((cell) => cell.trim())
  }
  return line
    .split(/[,，]|\s+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
}

export function parseImportText(text: string): ParsedImport {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (lines.length === 0) {
    return { header: null, rows: [] }
  }

  const firstCells = splitLine(lines[0]).map((cell) => cell.replace(/^﻿/, '').trim())
  const mapped = firstCells.map((cell) => HEADER_ALIASES[cell])
  // 至少能认出“测点编号 + 水平位移/垂直位移”才视为表头
  const looksLikeHeader =
    mapped.filter(Boolean).length >= 2 &&
    mapped.includes('pointCode') &&
    (mapped.includes('dx') || mapped.includes('dy'))

  if (looksLikeHeader) {
    const rows = lines.slice(1).map((line, index) => ({
      lineNo: index + 2,
      rawLine: line,
      cells: splitLine(line),
    }))
    return { header: mapped, rows }
  }

  const rows = lines.map((line, index) => ({
    lineNo: index + 1,
    rawLine: line,
    cells: splitLine(line),
  }))
  return { header: null, rows }
}

/** 按表头或固定列序取单元格；无表头时列序：测次,测点编号,高程,水平,垂直,日期 */
export function fieldOf(
  parsed: ParsedImport,
  row: RawFieldRow,
  field: (typeof FALLBACK_COLUMNS)[number],
): string {
  if (parsed.header) {
    const index = parsed.header.indexOf(field)
    return index >= 0 ? (row.cells[index] ?? '') : ''
  }
  const index = FALLBACK_COLUMNS.indexOf(field)
  return index >= 0 ? (row.cells[index] ?? '') : ''
}
