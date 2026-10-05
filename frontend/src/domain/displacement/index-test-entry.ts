/* eslint-disable no-console */
import {
  auditLog,
  alertsOfMonth,
  backfillRoundDate,
  commitImport,
  exportObservations,
  liveObservations,
  openAlerts,
  openTodos,
  previewImport,
  rejectLog,
  rounds,
  savePoint,
} from './service'
import { db } from './store'

let pass = 0
let fail = 0
function check(name: string, condition: boolean, extra = '') {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name} ${extra}`)
  }
}

export function run(): void {
  console.log('== 初始存量 ==')
  check('存量 9 行观测', liveObservations().length === 9, String(liveObservations().length))
  check('三个测次', rounds().length === 3, String(rounds().length))
  check('R01 无日期排最前', liveObservations()[0].roundNo === 'R01' && liveObservations()[0].observedAt === null)
  check('初始 1 条未关闭超限（DISP-02 R03）', openAlerts().length === 1, String(openAlerts().length))
  check('初始 2 条待办', openTodos().length === 2, String(openTodos().length))
  check('超限月报落在 2026-09', alertsOfMonth('2026-09').length === 1)
  const d2 = liveObservations().find((r) => r.pointCode === 'DISP-02' && r.roundNo === 'R03')!
  check('累计=√(12²+10²)=15.6', d2.cumulative === 15.6, String(d2.cumulative))
  check('比例 104.0%（按展示累计位移算，保证手算对得上）', d2.ratio === 104.0, String(d2.ratio))

  console.log('== 逐行核对：高程不符 / 编号未知 / 日期非法 / 行级重复 ==')
  const text = [
    '测次编号,测点编号,测点高程,水平位移,垂直位移,观测日期',
    'R04,DISP-01,845.00,15.2,-10.4,2026-10-05', // 过
    'R04,DISP-01,845.00,20.0,-20.0,2026-10-05', // 同测次同点重复：只认首次
    'R04,DISP-02,800.00,1.0,1.0,2026-10-05',    // 高程不符
    'R04,DISP-99,845.00,1.0,1.0,2026-10-05',    // 未知测点
    'R04,DISP-03,812.30,9.8,-6.5,not-a-date',   // 日期非法
    'R04,DISP-03,812.30,9.8,-6.5,',             // 空日期：纸次，可入库推定
  ].join('\n')
  const pv = previewImport(text, '外业R04.csv')
  const acc = pv.accepted.filter((i) => !i.duplicate)
  check('可入库 2 行（含空日期）', acc.length === 2, String(acc.length))
  check('重复登记 1 行', pv.accepted.filter((i) => i.duplicate).length === 1)
  check('校验不过 3 行', pv.rejected.filter((i) => !i.duplicate).length === 3, String(pv.rejected.length))
  commitImport(pv, '测试员')
  const r04 = liveObservations().filter((r) => r.roundNo === 'R04')
  check('R04 入库 2 行', r04.length === 2, String(r04.length))
  check('重复行只认首次取值 dx=15.2', r04.find((r) => r.pointCode === 'DISP-01')!.dx === 15.2)
  const d3r4 = r04.find((r) => r.pointCode === 'DISP-03')!
  check('空日期行 dateInferred', d3r4.observedAt === null && d3r4.dateInferred === true)
  check('新增补录待办（R04）', openTodos().some((t) => t.kind === '观测日期补录' && t.roundNo === 'R04'))
  check('校验另册含重复+校验共4条', rejectLog().length >= 4, String(rejectLog().length))

  console.log('== 同测次重复导入：最后一次为准，旧版 replaced 留痕 ==')
  const pv2 = previewImport('R03,DISP-01,845.00,1.0,1.0,2026-10-05\nR03,DISP-02,846.50,1.0,1.0,2026-10-05\nR03,DISP-03,812.30,1.0,1.0,2026-10-05', 'R03修正版.txt')
  commitImport(pv2, '测试员')
  const r03live = liveObservations().filter((r) => r.roundNo === 'R03')
  check('R03 现行 3 行（覆盖不叠加）', r03live.length === 3, String(r03live.length))
  check('R03 新值 dx=1', r03live.find((r) => r.pointCode === 'DISP-02')!.dx === 1)
  const oldR03 = db().observations.filter((r) => r.roundNo === 'R03' && r.replaced)
  check('旧版 R03 三行 replaced 留痕', oldR03.length === 3, String(oldR03.length))
  check('旧超限记录关闭，无新开单（1.4mm 不超限）', openAlerts().length === 0, String(openAlerts().length))
  check('旧超限待办随旧结论关闭', !openTodos().some((t) => t.kind === '位移超限处置' && t.roundNo === 'R03'))
  const firstSeen = r03live.find((r) => r.pointCode === 'DISP-02')!
  check('首次入库时间沿用旧版（2026-09）', firstSeen.firstSeenAt.startsWith('2026-09-21'), firstSeen.firstSeenAt)

  console.log('== 超限自动写入月报与待办 ==')
  const pv3 = previewImport('R05,DISP-03,812.30,20.0,-16.0,2026-10-05', 'R05.txt')
  const pre = pv3.accepted[0]
  check('预览累计 25.6 比例 102.4', pre.cumulative === 25.6 && pre.ratio === 102.4, `${pre.cumulative}/${pre.ratio}`)
  commitImport(pv3, '测试员')
  check('月报 2026-10 出现 1 条超限', alertsOfMonth('2026-10').length === 1)
  check('待办出现 R05 超限处置', openTodos().some((t) => t.kind === '位移超限处置' && t.roundNo === 'R05'))

  console.log('== 导出与页面同源 ==')
  const csv = exportObservations('R05').content
  check('导出累计列 25.6', csv.includes('25.6'))
  check('导出超限标记与累计列对得上', csv.includes('25.6,25,102.4,2026-10-05,否,超限'))

  console.log('== 事务回滚：阻断性错误不留中间态 ==')
  const beforeCount = liveObservations().length
  let threw = false
  try {
    // 全部是坏行 -> commitImport 抛错整笔退回
    const bad = previewImport('R06,DISP-99,845,1,1,2026-10-05', 'bad.csv')
    commitImport(bad, '测试员')
  } catch {
    threw = true
  }
  check('全坏行抛错', threw)
  check('观测行数不变（无中间态）', liveObservations().length === beforeCount, String(liveObservations().length))
  check('另册也不留这次痕迹', !rejectLog().some((r) => r.roundNo === 'R06'))

  console.log('== 无日期纸次补录：原值不动，月份联动 ==')
  backfillRoundDate('R01', '2026-07-08', '测试员')
  const r01 = liveObservations().filter((r) => r.roundNo === 'R01')
  check('R01 全部补上日期', r01.every((r) => r.observedAt === '2026-07-08'))
  check('R01 水平/垂直原值保留', r01.find((r) => r.pointCode === 'DISP-01')!.dx === 2.1)
  check('补录待办关闭', !openTodos().some((t) => t.kind === '观测日期补录' && t.roundNo === 'R01'))

  console.log('== 测点允许位移调整：台账与清单同事务变 ==')
  // 把 DISP-03 允许位移从 25 调小到 24：R05 25.6 仍超限；再调大到 30 应自动关闭
  savePoint({ id: db().points.find((p) => p.code === 'DISP-03')!.id, code: 'DISP-03', section: '下游坝坡 0+180', elevation: 812.3, allowable: 30 }, '测试员')
  check('放宽到30后 R05 超限解除', !liveObservations().find((r) => r.roundNo === 'R05' && r.pointCode === 'DISP-03')!.overLimit)
  check('对应月报超限记录关闭', alertsOfMonth('2026-10').length === 0)
  check('对应待办关闭', !openTodos().some((t) => t.roundNo === 'R05' && t.status === '待办'))

  console.log('== 审计留痕 ==')
  check('审计包含迁移/导入/补录/测点调整', auditLog().length >= 5, String(auditLog().length))

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
