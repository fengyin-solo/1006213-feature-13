/**
 * 位移台账纯逻辑测试，不依赖浏览器：node scripts/test-displacement.mjs
 * 用仓库自带的 tsc 把 TS 编译成临时 CommonJS 再跑（无需安装额外依赖）。
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'disp-test-'))
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    join(root, 'src/data/displacement/store.ts'),
    join(root, 'src/data/displacement/calc.ts'),
    join(root, 'src/data/displacement/parser.ts'),
    join(root, 'src/data/displacement/legacy.ts'),
    join(root, 'src/data/displacement/types.ts'),
    '--outDir',
    dir,
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--strict',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)

// 极简 localStorage 内存版
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}
globalThis.window = { localStorage: memoryStorage() }

const mod = require(join(dir, 'store.js'))
const calc = require(join(dir, 'calc.js'))
const { resultant, parseDate, parseNumber } = calc
const {
  importSession,
  backfillSessionDate,
  closeTodo,
  getLedger,
  monthlyOverlimits,
  openTodos,
  listSessions,
  listRejections,
  listImports,
  exportObservationsCsv,
  resetLedger,
  ELEVATION_TOLERANCE,
} = mod

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`)
}

console.log('calc：累计位移合成与比例')
eq('合成位移 √(3²+4²)=5', resultant(3, 4), 5)
eq('parseDate 短格式', parseDate('2026/9/1'), '2026-09-01')
eq('parseDate 紧凑格式', parseDate('20260901'), '2026-09-01')
eq('parseDate 中文格式', parseDate('2026年9月1日'), '2026-09-01')
eq('parseDate 拒绝非法日期', parseDate('2026-02-31'), null)
eq('parseNumber 带单位', parseNumber('12.5mm'), 12.5)

console.log('存量迁移：按发生顺序，纸档保持原样')
let { state, views } = getLedger()
eq('测点 6 个', state.points.length, 6)
eq('存量观测 27 条', state.observations.length, 27)
const paperSessions = listSessions().filter((s) => s.dateSource === 'paper')
eq('纸档测次 2 个', paperSessions.length, 2)
eq('纸档测次无日期', paperSessions.every((s) => s.obsDate === null), true)
eq('测次按发生顺序，纸档排最前', listSessions().slice(0, 2).map((s) => s.sessionCode), ['纸档-2024-1', '纸档-2024-2'])
const overRow = views.find((v) => v.point.code === 'DISP-0003')
check('DISP-0003 最新测次自动判超限', overRow.overLimit === true, `ratio=${overRow.ratio}`)
eq('超限占比 102%', overRow.ratio.toFixed(3), '1.022')
eq('累计位移重算 20.4mm', overRow.resultantMm, 20.4)

console.log('月报与值班待办：超限不只标在位移页')
const monthly = monthlyOverlimits()
eq('月报含 2026-09 一条超限', monthly.map((m) => `${m.month}/${m.pointCode}`), ['2026-09/DISP-0003'])
eq('值班待办开放 1 条', openTodos().length, 1)
eq('待办带测次与测点', openTodos()[0].title, 'DISP-0003 位移超限（测次 2026-09）')

console.log('导入：逐行核对，摘行说明缘由，其余入库')
const sample = `测次：2026-10
观测日期：2026/10/15
测点编号,测点高程,水平位移,垂直位移,累计位移,观测日期
DISP-0001,246.50,20.0,-9.0,99.9,2026/10/15
DISP-0002,248.12,24.8,-7.0,手填忽略,2026/10/15
DISP-0003,250.35,16.0,-14.0,,2026/10/15
DISP-0004,251.08,1.0,1.0,,2026-13-01
DISP-0005,253.00,1.0,1.0,,2026/10/15
DISP-0006,253.60,abc,1.0,,2026/10/15
DISP-0001,246.50,1.0,xyz,,2026/10/15
DISP-0009,246.50,1.0,1.0,,2026/10/15
DISP-0002,248.12,24.1,-7.1,,2026/10/15`
const outcome = importSession({ sessionCode: '2026-10', fileName: '2026-10.txt', rawText: sample })
eq('入库 3 行', outcome.accepted, 3)
eq('另摘 6 行', outcome.rejected, 6)
eq('识别到手填累计列', outcome.ignoredCumulativeColumn, true)
const reasons = outcome.rejectedRows.map((r) => r.reason)
check('不存在测点被摘', reasons.some((r) => r.includes('不存在')))
check('重复登记只认第一次', reasons.some((r) => r.includes('重复登记')))
check('高程不符写明差值', reasons.some((r) => r.includes('高程不符') && r.includes('800mm')))
check('水平非数值被摘', reasons.some((r) => r.includes('水平位移') && r.includes('不是数值')))
check('垂直非数值在重复行上不重复报', !reasons.some((r) => r.includes('垂直位移')))
check('非法日期被摘', reasons.some((r) => r.includes('无法识别为合法日期')))
eq('拒收行落库可查', listRejections('2026-10').length, 6)
{
  const { views: v } = getLedger()
  const p1 = v.find((x) => x.point.code === 'DISP-0001')
  eq('手填累计 99.9 被忽略，重算为 21.9', p1.resultantMm, 21.9)
  const p3 = v.find((x) => x.point.code === 'DISP-0003')
  check('DISP-0003 新测次仍超限', p3.overLimit, `ratio=${p3.ratio}`)
  eq('新测次使用行内日期', p3.obsDate, '2026-10-15')
}
eq('新超限自动进值班待办', openTodos().filter((t) => t.sessionCode === '2026-10').length, 2)

console.log('同一测次重导：最后一次整版覆盖，不叠加；旧版留痕')
const fixed = `测次：2026-10
DISP-0001 246.50 5.0 -1.0 2026/10/16
DISP-0002 248.12 2.0 1.0 2026/10/16
DISP-0003 250.35 3.0 1.0 2026/10/16`
const outcome2 = importSession({ sessionCode: '2026-10', fileName: '2026-10-v2.txt', rawText: fixed })
eq('第二次导入覆盖', outcome2.replacedSession, true)
eq('第二次入库 3 行', outcome2.accepted, 3)
{
  const { state: s } = getLedger()
  eq('该测次观测仍只有 3 条（不叠加）', s.observations.filter((o) => o.sessionCode === '2026-10').length, 3)
  const batches = listImports().filter((b) => b.sessionCode === '2026-10')
  eq('两个版本都在留痕里', batches.length, 2)
  const firstBatch = batches.find((b) => b.id === outcome.importId)
  const lastBatch = batches.find((b) => b.id === outcome2.importId)
  eq('第一次版本被标记 superseded', firstBatch.superseded, true)
  eq('第一次版本自身无快照', firstBatch.replacedSnapshot.length, 0)
  eq('第二次版本快照保留 3 行旧值', lastBatch.replacedSnapshot.length, 3)
  eq('快照里是被覆盖的旧值', lastBatch.replacedSnapshot.find((r) => r.pointCode === 'DISP-0001').dx, 20)
  eq('值班待办里旧超限已变陈旧消失', openTodos().filter((t) => t.sessionCode === '2026-10').length, 0)
  const staleTodos = s.todos.filter((t) => t.sessionCode === '2026-10')
  eq('旧超限待办保留留痕（stale）', staleTodos.every((t) => t.stale || t.status === 'closed'), true)
  // 2026-09 的超限仍在
  eq('存量 2026-09 超限待办不受影响', openTodos().filter((t) => t.sessionCode === '2026-09').length, 1)
}

console.log('事务：整笔退回不留中间态')
const before = JSON.stringify(getLedger().state)
let threw = ''
try {
  importSession({
    sessionCode: '2026-11',
    fileName: 'bad.txt',
    rawText: '乱七八遭一行没有测点\n也没有数据',
  })
} catch (e) {
  threw = e.message
}
check('无有效行时抛错', threw.includes('整笔退回'), threw)
eq('退回后状态完全不变', JSON.stringify(getLedger().state), before)
eq('不留空测次', listSessions().some((s) => s.sessionCode === '2026-11'), false)

let threw2 = ''
try {
  importSession({
    sessionCode: '2026-11',
    fileName: 'baddate.txt',
    rawText: '测次：2026-11\n观测日期：2026-13-40\nDISP-0001 246.50 5.0 -1.0',
  })
} catch (e) {
  threw2 = e.message
}
check('抬头日期非法整笔退回', threw2.includes('合法日期'), threw2)
eq('退回后观测数不变', getLedger().state.observations.length, 30)

console.log('纸档补录：早期条目原值保持，日期转正后才进月报')
const paperBefore = getLedger().state.observations.filter((o) => o.sessionCode === '纸档-2024-2')
{
  let err = ''
  try { backfillSessionDate('纸档-2024-2', 'not-a-date') } catch (e) { err = e.message }
  check('补录非法日期报错', err.includes('合法日期'), err)
  backfillSessionDate('纸档-2024-2', '2024/11/20')
  const { state: s } = getLedger()
  const rows = s.observations.filter((o) => o.sessionCode === '纸档-2024-2')
  eq('补录后日期转正', rows.every((r) => r.obsDate === '2024-11-20' && r.dateSource === 'dated'), true)
  eq('补录后原始读数不变', rows.map((r) => [r.dx, r.dy]), paperBefore.map((r) => [r.dx, r.dy]))
  eq('另一次纸档仍待核', listSessions().find((s) => s.sessionCode === '纸档-2024-1').dateSource, 'paper')
  // 纸档读数均未超限，月报仍只有一条
  eq('未超限的补录不产生待办', openTodos().length, 1)
}

console.log('待办办结：清单与台账共用一份')
{
  const todo = openTodos()[0]
  closeTodo(todo.id)
  eq('办结后值班入口看不到', openTodos().length, 0)
  eq('办结留痕仍可查', getLedger().state.todos.filter((t) => t.status === 'closed').length, 1)
}

console.log('导出：与页面同属一份，累计列与超限标记一致')
{
  resetLedger()
  const csv = exportObservationsCsv().content
  const lines = csv.split('\n')
  const header = lines[0]
  check('导出含累计列与超限列', header.includes('累计位移(mm)') && header.includes('超限标记'))
  const over = lines.find((l) => l.startsWith('2026-09,DISP-0003'))
  check('2026-09 DISP-0003 导出为超限', !!over && over.endsWith('超限'), over)
  check('累计 20.4 与页面一致', over?.includes(',20.4,'), over)
  const paper = lines.find((l) => l.startsWith('纸档-2024-1,DISP-0001'))
  check('纸档导出行存在且日期留空', !!paper && paper.split(',')[3] === '', paper)
  // 行数 = 表头 + 27 条存量
  eq('导出行数与台账一致', lines.length, 28)
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
