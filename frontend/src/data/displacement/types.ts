/** 位移观测台账领域类型。
 * 台账（points / observations）是唯一准据；imports 中保留外业原文与被覆盖旧版，仅作留痕。 */

/** 观测日期来源：dated=有确切观测日期；paper=早期纸档，日期待核（按发生顺序保留）。 */
export type DateSource = 'dated' | 'paper'

export interface Point {
  id: number
  /** 测点编号，如 DISP-0001，全台账唯一 */
  code: string
  /** 测点高程，单位 m，外业每行都要与它逐行核对 */
  elevation: number
  /** 允许位移（合位移限值），单位 mm */
  allowable: number
  /** 监测频次，如 每月1次 */
  frequency: string
  createdAt: string
}

export interface Observation {
  id: number
  /** 测次号，同一测次重导时整版覆盖 */
  sessionCode: string
  pointCode: string
  /** 行内抄录高程（m），入库时必须与测点台账一致（容差内） */
  elevation: number
  /** ISO 日期 yyyy-mm-dd；纸档待核时为 null */
  obsDate: string | null
  dateSource: DateSource
  /** 发生顺序：纸档按档案顺序编号，有日期的按日期编号 */
  seq: number
  /** 水平位移 dx，mm */
  dx: number
  /** 垂直位移 dy，mm */
  dy: number
  /** 入库批次；存量迁移为 null */
  importId: number | null
  migrated: boolean
}

export interface RejectedRow {
  id: number
  sessionCode: string
  importId: number
  lineNo: number
  rawLine: string
  pointCode: string
  /** 拒收缘由，逐行写清 */
  reason: string
  createdAt: string
}

export interface ImportBatch {
  id: number
  sessionCode: string
  fileName: string
  /** 测次抬头日期（可空） */
  headerDate: string | null
  importedAt: string
  accepted: number
  rejected: number
  /** 是否覆盖过同一测次的旧版本 */
  replacedSession: boolean
  /** 是否被之后的版本覆盖；被覆盖批次仅留痕 */
  superseded: boolean
  /** 外业文件原文（留痕，另一套结论） */
  rawText: string
  /** 被覆盖旧版本的解析值（留痕） */
  replacedSnapshot: Array<Pick<Observation, 'pointCode' | 'obsDate' | 'dx' | 'dy'>>
  /** 忽略了文件里的手填累计列（以系统重算为准） */
  ignoredCumulativeColumn: boolean
}

export interface TodoItem {
  id: number
  kind: 'overlimit'
  title: string
  detail: string
  pointCode: string
  sessionCode: string
  obsDate: string | null
  /** 超限占比（合成位移/允许位移） */
  ratio: number
  status: 'open' | 'closed'
  /** 重导后该超限不再成立：旧待办标陈旧留痕，不再出现在值班入口 */
  stale: boolean
  auto: boolean
  createdAt: string
  closedAt: string | null
}

export interface LedgerState {
  version: 1
  counters: { point: number; observation: number; rejection: number; importBatch: number; todo: number }
  points: Point[]
  observations: Observation[]
  rejections: RejectedRow[]
  imports: ImportBatch[]
  todos: TodoItem[]
  migrated: boolean
  migratedAt: string | null
}
