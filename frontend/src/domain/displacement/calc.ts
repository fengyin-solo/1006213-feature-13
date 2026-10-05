/**
 * 位移台账纯计算函数：不碰存储，方便单独核对。
 * 累计位移、占比、超限标记只在这一处算，页面 / 导出 / 月报 / 待办全部同源。
 */

/** 高程核对容差（m）：现场手簿与台账基准间允许的正常偏差 */
export const ELEVATION_TOLERANCE_M = 0.01

/** 累计位移（mm）：水平与垂直位移合成，禁止人工录入 */
export function calcCumulative(dx: number, dy: number): number {
  return round1(Math.sqrt(dx * dx + dy * dy))
}

/** 累计位移占允许位移的比例（%，保留一位小数） */
export function calcRatio(cumulative: number, allowable: number): number {
  if (!Number.isFinite(allowable) || allowable <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return round1((cumulative / allowable) * 100)
}

/** 超限判定：累计位移达到/超过允许位移（比例 ≥ 100%） */
export function isOverLimit(cumulative: number, allowable: number): boolean {
  if (!Number.isFinite(allowable) || allowable <= 0) {
    return true
  }
  return cumulative >= allowable
}

export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

/** 解析带单位/空白的数值，失败返回 null（单位 mm 统一去掉，高程 m 同理） */
export function parseNumber(raw: string): number | null {
  const text = raw.replace(/[毫米cmM\s]/gi, '').replace(/，/g, '.').replace(/,/g, '')
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * 解析观测日期。
 * - 空串：合法的「日期缺失」（早期纸质记录），返回 null，由调用方打推定标记；
 * - 无法识别或未来日期：返回 { error }，整行进校验另册。
 */
export function parseObservedDate(raw: string): { date: string | null; error?: string } {
  const text = raw.trim()
  if (text === '') {
    return { date: null }
  }
  const normalized = text.replace(/[./]/g, '-').replace(/年|月/g, '-').replace(/日/g, '')
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized.trim())
  if (!match) {
    return { date: null, error: `观测日期「${raw}」无法识别` }
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { date: null, error: `观测日期「${raw}」不是有效日期` }
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { date: null, error: `观测日期「${raw}」不是有效日期` }
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (date.getTime() > today.getTime()) {
    return { date: null, error: `观测日期「${raw}」晚于今天` }
  }
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

/** 测次内的顺序序号：从 R01、第3次、测次12 等写法中提取，用于无日期时按发生顺序排 */
export function roundOrder(roundNo: string): number {
  const match = /(\d+)/.exec(roundNo)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

/**
 * 观测行排序键：存量条目按发生顺序迁移，无日期的早期纸次排在最前（不臆造日期）。
 * 同日按测次序号，再按测点编号，保证顺序稳定。
 */
export function sortKey(row: { observedAt: string | null; roundNo: string; pointCode: string }): string {
  const datePart = row.observedAt ?? '0000-00-00'
  const seqPart = String(roundOrder(row.roundNo)).padStart(6, '0')
  return `${datePart}#${seqPart}#${row.pointCode}`
}

export function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null
}
