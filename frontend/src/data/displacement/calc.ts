/** 位移台账纯计算函数：累计位移与超限判定只在这里算一次，
 * 页面、导出、月报、待办全部调用同一套结论，杜绝手填与两处对不上。 */

/** 合成位移：√(水平² + 垂直²)，mm。 */
export function resultant(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

/** 累计位移按「允许位移的比例」重算：合成位移 ÷ 允许位移。 */
export function ratioOf(dx: number, dy: number, allowable: number): number {
  if (!Number.isFinite(allowable) || allowable <= 0) {
    return Number.NaN
  }
  return resultant(dx, dy) / allowable
}

export function isOverLimit(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio > 1
}

/** 保留一位小数（mm），避免 1.0000000002 一类浮点尾巴进导出。 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function roundRatio(ratio: number): number {
  return Math.round(ratio * 1000) / 1000
}

/** 解析数字串：允许空白、全角逗号、单位（mm/m）。返回 null 表示不是合法数字。 */
export function parseNumber(raw: string): number | null {
  if (raw === undefined || raw === null) return null
  const cleaned = String(raw)
    .replace(/[，,]/g, '')
    .replace(/[ｍm]/gi, '')
    .trim()
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** 解析观测日期，兼容 2026-09-01 / 2026/9/1 / 20260901 / 2026年9月1日。
 * 用日期往返校验拒绝 2026-02-31 这类非法日期。返回 ISO 串或 null。 */
export function parseDate(raw: string): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  let year = 0
  let month = 0
  let day = 0
  const cn = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/)
  if (cn) {
    ;[year, month, day] = [Number(cn[1]), Number(cn[2]), Number(cn[3])]
  } else if (/^\d{8}$/.test(text)) {
    year = Number(text.slice(0, 4))
    month = Number(text.slice(4, 6))
    day = Number(text.slice(6, 8))
  } else {
    const parts = text.split(/[-/.]/)
    if (parts.length !== 3) return null
    year = Number(parts[0])
    month = Number(parts[1])
    day = Number(parts[2])
  }
  if (!year || !month || !day) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
