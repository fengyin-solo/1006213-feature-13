/**
 * 位移观测台账领域模型。
 *
 * 这一份数据同时被三个入口读取：
 *  - 位移监测页（/displacement）：测点台账、观测成果、校验另册、导入导出
 *  - 监测月报（/monthly-report）：监测值班看超限记录的另一个入口
 *  - 备品备件页（/spare）：业务待办清单（超限处置 / 观测日期补录）
 *
 * 关键裁定（页面说明与审计日志同口径）：
 *  1. 测次级重复导入：以最后一次为准，旧版本整笔作废（replaced=true）但保留留痕；
 *  2. 同一测次内同一测点重复登记：只认第一次取值，后到的行进校验另册留痕；
 *  3. 累计位移由水平/垂直位移系统合成，禁止手填；占允许位移比例、超限标记同源派生；
 *  4. 早期纸质无日期测次不臆造日期：按发生顺序排前、dateInferred 标记、待补录。
 */

/** 测点台账（主数据） */
export type DisplacementPoint = {
  id: string
  /** 测点编号，外业文件按它核对 */
  code: string
  /** 测点部位/断面 */
  section: string
  /** 台账高程（m），逐行核对观测行填报高程的基准 */
  elevation: number
  /** 允许位移（mm） */
  allowable: number
  createdAt: string
  updatedAt: string
}

/** 观测成果行（一个测点一个测次一行） */
export type ObservationRow = {
  id: string
  /** 所属导入批次；存量迁移行为 'LEGACY' */
  batchId: string
  /** 测次编号，如 R03 */
  roundNo: string
  pointCode: string
  /** 外业行填报的测点高程（m），入库前已与台账高程核对 */
  elevationObserved: number
  /** 水平位移（mm，外业原值） */
  dx: number
  /** 垂直位移（mm，外业原值） */
  dy: number
  /** 观测日期 YYYY-MM-DD；早期纸质无日期为 null */
  observedAt: string | null
  /** 观测日期缺失：按测次发生顺序推定排序，不臆造具体日期 */
  dateInferred: boolean
  /** 存量迁移条目：水平/垂直原值保持原样，仅累计列由系统重算 */
  source: 'legacy' | 'import'
  /** 同一测次+测点第一次入库时间（重复登记只认第一次，此时间随整测替换沿用） */
  firstSeenAt: string
  updatedAt: string
  /** 被同测次后一次导入整笔覆盖：false 才是现行结论，true 仅留痕 */
  replaced: boolean

  // —— 以下为系统派生列，任何入口与导出文件都只读这里 ——
  /** 累计位移（mm）= √(dx² + dy²)，由系统重算，禁止手填 */
  cumulative: number
  /** 累计位移占允许位移的百分比（%） */
  ratio: number
  /** 超限标记：累计位移 ≥ 允许位移，与 ratio 同源，保证对得上 */
  overLimit: boolean
}

/** 校验另册：校验不过的行 / 同测次重复登记行，逐行写清缘由 */
export type RejectRow = {
  id: string
  batchId: string
  roundNo: string
  pointCode: string
  /** 原始行文本，留痕 */
  rawLine: string
  reason: string
  category: '校验未过' | '重复登记'
  occurredAt: string
}

/** 一次外业文件导入（按测次各生成一条；一个文件可含多个测次） */
export type ImportBatch = {
  id: string
  roundNo: string
  /** 同一测次第几次导入（重复导入版本号） */
  seq: number
  fileName: string
  importedAt: string
  acceptedCount: number
  rejectedCount: number
  duplicateCount: number
  /** 本次覆盖的上一批次 id（留痕链路） */
  replacedBatchId: string | null
  note: string
}

/** 超限记录：自动写入，监测月报与待办都从这里取，不只标在位移页面 */
export type AlertRecord = {
  id: string
  pointCode: string
  roundNo: string
  observedAt: string | null
  dateInferred: boolean
  cumulative: number
  allowable: number
  ratio: number
  batchId: string
  /** 首次超限时间 */
  openedAt: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedReason: string | null
}

export type TodoKind = '位移超限处置' | '观测日期补录'

export type TodoItem = {
  id: string
  kind: TodoKind
  /** 关联对象：alert（超限）/ observation-round（补录） */
  refType: 'alert' | 'round'
  refId: string
  title: string
  detail: string
  pointCode: string
  roundNo: string
  /** 归属月份 YYYY-MM；无日期为 null（不臆造月份） */
  month: string | null
  createdAt: string
  status: '待办' | '已办'
  doneAt: string | null
  handledBy: string | null
  handleNote: string | null
}

export type AuditEntry = {
  id: string
  at: string
  actor: string
  action: string
  detail: string
  batchId?: string
}

export type DisplacementDB = {
  version: number
  points: DisplacementPoint[]
  observations: ObservationRow[]
  rejects: RejectRow[]
  batches: ImportBatch[]
  alerts: AlertRecord[]
  todos: TodoItem[]
  audit: AuditEntry[]
  /** 旧通用台账扫描标记（一次性） */
  legacyScanAt: string | null
}
