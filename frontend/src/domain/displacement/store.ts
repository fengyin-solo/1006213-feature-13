import { reactive } from 'vue'

import { SEED_ROWS } from '@/data/seed'
import { storageKey as genericStorageKey } from '@/data/local-store'

import { parseNumber } from './calc'
import { createSeedDB } from './seed'
import type { DisplacementDB } from './types'

// 位移台账独立一份 localStorage：台账、月报、备品待办都读它，保证“同属一份”。
export const STORAGE_KEY = 'hydropower-plant-om:displacement-ledger:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readDB(): DisplacementDB {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createSeedDB()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as DisplacementDB
    } catch {
      // 落库内容损坏时不覆盖，回退到内存种子，等下一次成功事务再写回
      return createSeedDB()
    }
  }
  const seeded = createSeedDB()
  scanGenericLegacy(seeded)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}

/**
 * 一次性扫描旧通用台账里的位移表（hydropower-plant-om:entries/displacement）。
 * 迁移裁定：通用行没有测次/日期字段，不能当作观测成果回填——它们属于旧手填台账，
 * 与新台账“按测次组织”的口径不一致。这里只留一条审计说明，绝不与新台账叠加，
 * 避免“累计位移算重了”的老问题再出现。
 */
function scanGenericLegacy(db: DisplacementDB): void {
  const now = nowStamp()
  let legacyCount = 0
  try {
    const raw = window.localStorage.getItem(genericStorageKey())
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    const rows = parsed && Array.isArray(parsed.displacement)
      ? (parsed.displacement as Record<string, unknown>[])
      : SEED_ROWS.displacement as unknown as Record<string, unknown>[]
    legacyCount = rows.length
    // 只有当旧行确实带有可用的数值观测时才统计；占位文本行不算存量观测
    const numericRows = rows.filter((row) => parseNumber(String(row['水平位移'] ?? '')) !== null)
    db.audit.push({
      id: genId('AU', db.audit),
      at: now,
      actor: '系统迁移',
      action: '旧手填位移台账核对',
      detail:
        numericRows.length > 0
          ? `旧手填位移表另有 ${numericRows.length} 行数值记录但无测次/观测日期，未并入按测次组织的新台账，请按测次补录。`
          : `旧位移表 ${legacyCount} 行为通用占位/手填记录，无测次与观测日期，不并入新台账（避免累计位移重复计算）。`,
    })
  } catch {
    db.audit.push({
      id: genId('AU', db.audit),
      at: now,
      actor: '系统迁移',
      action: '旧手填位移台账核对',
      detail: '旧位移表无法解析，未并入新台账。',
    })
  }
  db.legacyScanAt = now
}

const state = reactive<DisplacementDB>(readDB())

/** 只读快照：页面拿到的就是当前落库版本 */
export function db(): DisplacementDB {
  return state
}

export function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '')
}

/** 数字前缀 id 生成器，按同表内已有条数顺延 */
export function genId(prefix: string, list: { id: string }[]): string {
  let max = 0
  for (const item of list) {
    const match = /(\d+)$/.exec(item.id)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

/**
 * 事务：业务函数只在克隆副本上改，全部走完才一次性整笔落库；
 * 中途抛错则整笔退回，内存与 localStorage 都不留下中间态。
 */
export function transaction<T>(fn: (draft: DisplacementDB) => T): T {
  const snapshot = clone(state) as DisplacementDB
  try {
    const result = fn(state)
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
    return result
  } catch (error) {
    // 整体回滚：用快照覆盖响应式状态，保证视图也回到事务前，不留下中间态
    Object.assign(state, snapshot)
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
    throw error
  }
}

export function addAudit(
  draft: DisplacementDB,
  actor: string,
  action: string,
  detail: string,
  batchId?: string,
): void {
  draft.audit.unshift({
    id: genId('AU', draft.audit),
    at: nowStamp(),
    actor,
    action,
    detail,
    ...(batchId ? { batchId } : {}),
  })
}
