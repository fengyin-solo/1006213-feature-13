/** 存量位移观测数据：模拟台账上线时从旧台账与纸档搬过来的历史记录。
 * 迁移按发生顺序进行；早期纸档没有观测日期，日期留空、保持原样，不臆造日期。 */

export interface LegacyPoint {
  code: string
  elevation: number
  allowable: number
  frequency: string
}

export interface LegacySession {
  /** 发生顺序即数组顺序 */
  code: string
  /** 纸档测次为 null */
  date: string | null
  paper?: boolean
}

export interface LegacyObservation {
  sessionCode: string
  pointCode: string
  elevation: number
  dx: number
  dy: number
}

export const LEGACY_POINTS: LegacyPoint[] = [
  { code: 'DISP-0001', elevation: 246.5, allowable: 30, frequency: '每月1次' },
  { code: 'DISP-0002', elevation: 248.12, allowable: 25, frequency: '每月1次' },
  { code: 'DISP-0003', elevation: 250.35, allowable: 20, frequency: '每月1次' },
  { code: 'DISP-0004', elevation: 251.08, allowable: 20, frequency: '每月1次' },
  { code: 'DISP-0005', elevation: 252.2, allowable: 20, frequency: '每月1次' },
  { code: 'DISP-0006', elevation: 253.6, allowable: 20, frequency: '每月1次' },
]

export const LEGACY_SESSIONS: LegacySession[] = [
  { code: '纸档-2024-1', date: null, paper: true },
  { code: '纸档-2024-2', date: null, paper: true },
  { code: '2025-03', date: '2025-03-15' },
  { code: '2025-06', date: '2025-06-18' },
  { code: '2025-09', date: '2025-09-20' },
  { code: '2025-12', date: '2025-12-18' },
  { code: '2026-03', date: '2026-03-19' },
  { code: '2026-06', date: '2026-06-17' },
  { code: '2026-09', date: '2026-09-15' },
]

/** 每个存量测次都含 3 个测点；dx/dy 为旧台账抄录的读数（mm）。
 * 2026-09 测次 DISP-0003 已超允许位移，迁移后必须在月报与值班待办里看到。 */
export const LEGACY_OBSERVATIONS: LegacyObservation[] = [
  // 纸档-2024-1
  { sessionCode: '纸档-2024-1', pointCode: 'DISP-0001', elevation: 246.5, dx: 2.1, dy: -1.0 },
  { sessionCode: '纸档-2024-1', pointCode: 'DISP-0002', elevation: 248.12, dx: 1.2, dy: 0.8 },
  { sessionCode: '纸档-2024-1', pointCode: 'DISP-0003', elevation: 250.35, dx: 0.8, dy: -0.5 },
  // 纸档-2024-2
  { sessionCode: '纸档-2024-2', pointCode: 'DISP-0001', elevation: 246.5, dx: 3.4, dy: -1.8 },
  { sessionCode: '纸档-2024-2', pointCode: 'DISP-0002', elevation: 248.12, dx: 2.0, dy: 1.4 },
  { sessionCode: '纸档-2024-2', pointCode: 'DISP-0003', elevation: 250.35, dx: 1.5, dy: -0.9 },
  // 2025-03
  { sessionCode: '2025-03', pointCode: 'DISP-0001', elevation: 246.5, dx: 5.2, dy: -2.4 },
  { sessionCode: '2025-03', pointCode: 'DISP-0002', elevation: 248.12, dx: 3.1, dy: 2.2 },
  { sessionCode: '2025-03', pointCode: 'DISP-0003', elevation: 250.35, dx: 2.6, dy: -1.4 },
  // 2025-06
  { sessionCode: '2025-06', pointCode: 'DISP-0001', elevation: 246.5, dx: 8.0, dy: -3.6 },
  { sessionCode: '2025-06', pointCode: 'DISP-0002', elevation: 248.12, dx: 4.6, dy: 3.0 },
  { sessionCode: '2025-06', pointCode: 'DISP-0003', elevation: 250.35, dx: 4.0, dy: -2.2 },
  // 2025-09
  { sessionCode: '2025-09', pointCode: 'DISP-0001', elevation: 246.5, dx: 10.6, dy: -4.8 },
  { sessionCode: '2025-09', pointCode: 'DISP-0002', elevation: 248.12, dx: 6.0, dy: 3.9 },
  { sessionCode: '2025-09', pointCode: 'DISP-0003', elevation: 250.35, dx: 5.6, dy: -3.0 },
  // 2025-12
  { sessionCode: '2025-12', pointCode: 'DISP-0001', elevation: 246.5, dx: 12.2, dy: -5.5 },
  { sessionCode: '2025-12', pointCode: 'DISP-0002', elevation: 248.12, dx: 7.2, dy: 4.6 },
  { sessionCode: '2025-12', pointCode: 'DISP-0003', elevation: 250.35, dx: 7.0, dy: -3.8 },
  // 2026-03
  { sessionCode: '2026-03', pointCode: 'DISP-0001', elevation: 246.5, dx: 14.0, dy: -6.3 },
  { sessionCode: '2026-03', pointCode: 'DISP-0002', elevation: 248.12, dx: 8.5, dy: 5.2 },
  { sessionCode: '2026-03', pointCode: 'DISP-0003', elevation: 250.35, dx: 8.4, dy: -4.6 },
  // 2026-06
  { sessionCode: '2026-06', pointCode: 'DISP-0001', elevation: 246.5, dx: 15.8, dy: -7.1 },
  { sessionCode: '2026-06', pointCode: 'DISP-0002', elevation: 248.12, dx: 9.6, dy: 5.8 },
  { sessionCode: '2026-06', pointCode: 'DISP-0003', elevation: 250.35, dx: 9.8, dy: -5.5 },
  // 2026-09（DISP-0003：√(15.6²+13.2²)=20.4mm > 允许 20mm，超限）
  { sessionCode: '2026-09', pointCode: 'DISP-0001', elevation: 246.5, dx: 18.5, dy: -8.2 },
  { sessionCode: '2026-09', pointCode: 'DISP-0002', elevation: 248.12, dx: 11.0, dy: 6.4 },
  { sessionCode: '2026-09', pointCode: 'DISP-0003', elevation: 250.35, dx: 15.6, dy: -13.2 },
]
