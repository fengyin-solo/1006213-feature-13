import { calcCumulative, calcRatio, isOverLimit } from './calc'
import type {
  AlertRecord,
  AuditEntry,
  DisplacementDB,
  DisplacementPoint,
  ImportBatch,
  ObservationRow,
  RejectRow,
  TodoItem,
} from './types'

// 首次进入台账时播种：这一份就是“存量数据按发生顺序迁移”后的样子。
// 早期纸质测次 R01 没有观测日期——不臆造日期，按测次序排在最前并挂一条补录待办。
const LEGACY_BATCH = 'B-LEGACY'

function point(
  id: string,
  code: string,
  section: string,
  elevation: number,
  allowable: number,
): DisplacementPoint {
  return {
    id,
    code,
    section,
    elevation,
    allowable,
    createdAt: '2026-07-01T08:00:00',
    updatedAt: '2026-07-01T08:00:00',
  }
}

const rawLegacy: Array<{
  roundNo: string
  pointCode: string
  elevationObserved: number
  dx: number
  dy: number
  observedAt: string | null
  firstSeenAt: string
}> = [
  // R01：最早一期，纸质记录，观测日期缺失（dateInferred），按测次顺序推定排前
  { roundNo: 'R01', pointCode: 'DISP-01', elevationObserved: 845.0, dx: 2.1, dy: -1.0, observedAt: null, firstSeenAt: '2026-07-10T09:00:00' },
  { roundNo: 'R01', pointCode: 'DISP-02', elevationObserved: 846.5, dx: 1.2, dy: 0.8, observedAt: null, firstSeenAt: '2026-07-10T09:00:00' },
  { roundNo: 'R01', pointCode: 'DISP-03', elevationObserved: 812.3, dx: 3.0, dy: -2.2, observedAt: null, firstSeenAt: '2026-07-10T09:00:00' },
  { roundNo: 'R02', pointCode: 'DISP-01', elevationObserved: 845.01, dx: 6.5, dy: -4.0, observedAt: '2026-08-15', firstSeenAt: '2026-08-16T09:00:00' },
  { roundNo: 'R02', pointCode: 'DISP-02', elevationObserved: 846.49, dx: 9.0, dy: 5.5, observedAt: '2026-08-15', firstSeenAt: '2026-08-16T09:00:00' },
  { roundNo: 'R02', pointCode: 'DISP-03', elevationObserved: 812.31, dx: 8.2, dy: -6.1, observedAt: '2026-08-15', firstSeenAt: '2026-08-16T09:00:00' },
  // R03：DISP-02 超限（15.6/15），自动产生超限记录并写入月报与待办
  { roundNo: 'R03', pointCode: 'DISP-01', elevationObserved: 845.0, dx: 14.0, dy: -9.5, observedAt: '2026-09-20', firstSeenAt: '2026-09-21T09:00:00' },
  { roundNo: 'R03', pointCode: 'DISP-02', elevationObserved: 846.5, dx: 12.0, dy: 10.0, observedAt: '2026-09-20', firstSeenAt: '2026-09-21T09:00:00' },
  { roundNo: 'R03', pointCode: 'DISP-03', elevationObserved: 812.29, dx: 10.5, dy: -7.0, observedAt: '2026-09-20', firstSeenAt: '2026-09-21T09:00:00' },
]

function buildSeedDB(): DisplacementDB {
  const points = [
    point('P-0001', 'DISP-01', '大坝坝顶 0+120', 845.0, 20),
    point('P-0002', 'DISP-02', '大坝坝顶 0+240', 846.5, 15),
    point('P-0003', 'DISP-03', '下游坝坡 0+180', 812.3, 25),
  ]
  const allowableByCode = new Map(points.map((item) => [item.code, item.allowable]))

  const observations: ObservationRow[] = rawLegacy.map((item, index) => {
    const cumulative = calcCumulative(item.dx, item.dy)
    const allowable = allowableByCode.get(item.pointCode) ?? 0
    return {
      id: `O-LEG-${String(index + 1).padStart(3, '0')}`,
      batchId: LEGACY_BATCH,
      roundNo: item.roundNo,
      pointCode: item.pointCode,
      elevationObserved: item.elevationObserved,
      dx: item.dx,
      dy: item.dy,
      observedAt: item.observedAt,
      dateInferred: item.observedAt === null,
      source: 'legacy',
      firstSeenAt: item.firstSeenAt,
      updatedAt: item.firstSeenAt,
      replaced: false,
      cumulative,
      ratio: calcRatio(cumulative, allowable),
      overLimit: isOverLimit(cumulative, allowable),
    }
  })

  const overRow = observations.find((row) => row.pointCode === 'DISP-02' && row.roundNo === 'R03')!
  const alerts: AlertRecord[] = [
    {
      id: 'A-0001',
      pointCode: 'DISP-02',
      roundNo: 'R03',
      observedAt: '2026-09-20',
      dateInferred: false,
      cumulative: overRow.cumulative,
      allowable: 15,
      ratio: overRow.ratio,
      batchId: LEGACY_BATCH,
      openedAt: '2026-09-21T09:00:00',
      status: 'open',
      closedAt: null,
      closedReason: null,
    },
  ]

  const todos: TodoItem[] = [
    {
      id: 'T-0001',
      kind: '位移超限处置',
      refType: 'alert',
      refId: 'A-0001',
      title: 'DISP-02 R03 累计位移 15.6mm 超过允许 15mm（104.0%）',
      detail: '观测日期 2026-09-20，水平 12.0mm / 垂直 10.0mm，请安排复核与处置。',
      pointCode: 'DISP-02',
      roundNo: 'R03',
      month: '2026-09',
      createdAt: '2026-09-21T09:00:00',
      status: '待办',
      doneAt: null,
      handledBy: null,
      handleNote: null,
    },
    {
      id: 'T-0002',
      kind: '观测日期补录',
      refType: 'round',
      refId: 'R01',
      title: 'R01 为早期纸质记录，观测日期缺失',
      detail: '已按测次发生顺序推定排在最早，请凭纸质手簿补录观测日期后归入正确月份。',
      pointCode: 'DISP-01/DISP-02/DISP-03',
      roundNo: 'R01',
      month: null,
      createdAt: '2026-07-01T08:00:00',
      status: '待办',
      doneAt: null,
      handledBy: null,
      handleNote: null,
    },
  ]

  const rejects: RejectRow[] = [
    {
      id: 'R-LEG-0001',
      batchId: LEGACY_BATCH,
      roundNo: 'R00',
      pointCode: 'DISP-09',
      rawLine: 'R00, DISP-09, 800.00, 1.0, 0.5, ',
      reason: '测点编号 DISP-09 未在测点台账登记',
      category: '校验未过',
      occurredAt: '2026-07-01T08:00:00',
    },
  ]

  const batches: ImportBatch[] = [
    {
      id: LEGACY_BATCH,
      roundNo: 'R01/R02/R03',
      seq: 0,
      fileName: '存量观测数据（含纸质记录）',
      importedAt: '2026-07-01T08:00:00',
      acceptedCount: observations.length,
      rejectedCount: rejects.length,
      duplicateCount: 0,
      replacedBatchId: null,
      note: '存量按发生顺序迁移：早期条目水平/垂直原值保留，累计位移统一重算',
    },
  ]

  const audit: AuditEntry[] = [
    {
      id: 'AU-0001',
      at: '2026-07-01T08:00:00',
      actor: '系统迁移',
      action: '存量数据迁移',
      detail:
        '存量观测数据按发生顺序迁移：无日期纸质测次 R01 按测次序推定排前并挂补录待办；累计位移、占比、超限标记由系统统一重算。',
      batchId: LEGACY_BATCH,
    },
  ]

  return {
    version: 1,
    points,
    observations,
    rejects,
    batches,
    alerts,
    todos,
    audit,
    legacyScanAt: null,
  }
}

export function createSeedDB(): DisplacementDB {
  return JSON.parse(JSON.stringify(buildSeedDB())) as DisplacementDB
}
