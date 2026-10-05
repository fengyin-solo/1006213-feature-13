<template>
  <section class="page" data-module="monthly-report">
    <header class="page-head">
      <div>
        <h2>监测月报 · 位移观测</h2>
        <p class="page-desc">
          监测值班入口：超限记录由位移台账自动写入，这里与位移页面是同一份数据，不依赖人工转述。
          导出的月报与页面一致，累计位移列与超限标记同源对得上。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="doExportReport">导出本月月报</button>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>报告月份</span>
        <select v-model="selectedMonth">
          <option v-for="month in months" :key="month" :value="month">{{ month }}</option>
        </select>
      </label>
    </form>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">本月观测行数</span>
        <strong class="stat-value">{{ monthRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">覆盖测次</span>
        <strong class="stat-value">{{ monthRounds.size }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">本月超限记录</span>
        <strong class="stat-value" :class="{ 'warn-text': monthAlerts.length > 0 }">{{ monthAlerts.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">最大占允许比例</span>
        <strong class="stat-value" :class="{ 'warn-text': maxRatio >= 100 }">{{ Number.isFinite(maxRatio) ? maxRatio + '%' : '—' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待补观测日期</span>
        <strong class="stat-value" :class="{ 'warn-text': inferredRounds.size > 0 }">{{ inferredRounds.size }}</strong>
      </article>
    </div>

    <h3 class="sub-title">超限记录（值班跟办）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>测点编号</th><th>测次</th><th>观测日期</th><th>累计位移(mm)</th><th>允许(mm)</th>
          <th>占允许比例</th><th>状态</th><th>开单时间</th><th>关闭说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="alert in monthAlerts" :key="alert.id" class="row-warn">
          <td>{{ alert.pointCode }}</td>
          <td>{{ alert.roundNo }}</td>
          <td>{{ alert.observedAt ?? '日期缺失' }}</td>
          <td>{{ alert.cumulative }}</td>
          <td>{{ alert.allowable }}</td>
          <td class="warn-text">{{ Number.isFinite(alert.ratio) ? alert.ratio + '%' : '∞' }}</td>
          <td><span class="tag over">{{ alert.status === 'open' ? '未关闭' : '已关闭' }}</span></td>
          <td>{{ alert.openedAt }}</td>
          <td>{{ alert.closedReason ?? '—' }}</td>
        </tr>
        <tr v-if="!monthAlerts.length">
          <td colspan="9" class="empty-state">{{ selectedMonth }} 无超限记录</td>
        </tr>
      </tbody>
    </table>

    <div v-if="inferredRounds.size" class="inferred-box">
      <strong>待补录（不计入任何自然月份，避免把纸次错算进月报）：</strong>
      <span v-for="roundNo in inferredRounds" :key="roundNo" class="tag inferred">
        {{ roundNo }} 观测日期缺失
        <button class="link" type="button" @click="askBackfill(roundNo)">补录日期</button>
      </span>
    </div>

    <h3 class="sub-title">本月观测成果（同导出文件）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>测次</th><th>测点编号</th><th>水平(mm)</th><th>垂直(mm)</th>
          <th>累计位移(mm)</th><th>允许(mm)</th><th>占允许比例</th><th>观测日期</th><th>超限标记</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in monthRows" :key="row.id" :class="{ 'row-warn': row.overLimit }">
          <td>{{ row.roundNo }}</td>
          <td>{{ row.pointCode }}</td>
          <td>{{ row.dx }}</td>
          <td>{{ row.dy }}</td>
          <td>{{ row.cumulative }}</td>
          <td>{{ pointAllowable(row.pointCode) }}</td>
          <td :class="row.overLimit ? 'warn-text' : ''">{{ row.ratio === Infinity ? '∞' : row.ratio + '%' }}</td>
          <td>{{ row.observedAt }}</td>
          <td><span :class="row.overLimit ? 'tag over' : 'tag ok'">{{ row.overLimit ? '超限' : '正常' }}</span></td>
        </tr>
        <tr v-if="!monthRows.length">
          <td colspan="9" class="empty-state">{{ selectedMonth }} 暂无观测成果</td>
        </tr>
      </tbody>
    </table>

    <BusinessTodoPanel />

    <div v-if="backfillTarget" class="modal-mask" @click.self="backfillTarget = null">
      <form class="modal small" @submit.prevent="confirmBackfill">
        <h3 class="sub-title">补录测次 {{ backfillTarget }} 的观测日期</h3>
        <p class="hint-text">凭纸质手簿填写；补录后该测次超限记录与待办自动归入对应月份，水平/垂直原值保持不变。</p>
        <label class="form-item">
          <span>观测日期</span>
          <input v-model="backfillDate" type="date" required />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认补录</button>
          <button class="btn ghost" type="button" @click="backfillTarget = null">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import BusinessTodoPanel from '@/components/BusinessTodoPanel.vue'
import { useSessionStore } from '@/stores/session'
import {
  alertsOfMonth,
  download,
  liveObservations,
  pointByCode,
  backfillRoundDate,
  reportMonths,
} from '@/domain/displacement/service'

const session = useSessionStore()
const months = computed(() => reportMonths())
const selectedMonth = ref(months.value[0] ?? new Date().toISOString().slice(0, 7))

const monthRows = computed(() =>
  liveObservations().filter((row) => row.observedAt?.slice(0, 7) === selectedMonth.value),
)
const monthRounds = computed(() => new Set(monthRows.value.map((row) => row.roundNo)))
const monthAlerts = computed(() => alertsOfMonth(selectedMonth.value))
const maxRatio = computed(() =>
  monthRows.value.reduce((max, row) => (Number.isFinite(row.ratio) ? Math.max(max, row.ratio) : max), 0),
)
// 无日期纸次：不臆造月份，单列“待补录”
const inferredRounds = computed(
  () => new Set(liveObservations().filter((row) => row.observedAt === null).map((row) => row.roundNo)),
)

function pointAllowable(code: string): number | string {
  return pointByCode(code)?.allowable ?? '—'
}

function doExportReport() {
  const month = selectedMonth.value
  const headers = ['测点编号', '测次', '水平位移(mm)', '垂直位移(mm)', '累计位移(mm)', '允许位移(mm)', '占允许比例(%)', '观测日期', '超限标记']
  const lines = [headers.join(',')]
  for (const row of monthRows.value) {
    lines.push(
      [row.pointCode, row.roundNo, row.dx, row.dy, row.cumulative, pointAllowable(row.pointCode),
        Number.isFinite(row.ratio) ? row.ratio : '∞', row.observedAt, row.overLimit ? '超限' : '正常'].join(','),
    )
  }
  lines.push('')
  lines.push(`超限记录数,${monthAlerts.value.length}`)
  for (const alert of monthAlerts.value) {
    lines.push(
      ['超限', alert.pointCode, alert.roundNo, alert.cumulative, alert.allowable,
        Number.isFinite(alert.ratio) ? alert.ratio : '∞', alert.observedAt ?? '日期缺失', alert.status].join(','),
    )
  }
  download(`位移监测月报-${month}.csv`, `﻿${lines.join('\n')}`)
}

const backfillTarget = ref<string | null>(null)
const backfillDate = ref('')
const errorMessage = ref('')
function askBackfill(roundNo: string) {
  backfillTarget.value = roundNo
  backfillDate.value = ''
  errorMessage.value = ''
}
function confirmBackfill() {
  if (!backfillTarget.value) {
    return
  }
  try {
    backfillRoundDate(backfillTarget.value, backfillDate.value, session.operator)
    backfillTarget.value = null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '补录失败，整笔退回'
  }
}
</script>

<style scoped>
.warn-text { color: #b42318; font-weight: 600; }
.sub-title { font-size: 14px; margin: 14px 0 8px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.tag.ok { background: #e6f4ea; color: #17663a; }
.tag.over { background: #fde8e6; color: #b42318; }
.tag.inferred { background: #eef2f7; color: var(--muted); margin-left: 6px; padding: 3px 10px; }
.row-warn { background: #fff7f6; }
.inferred-box { margin: 12px 0; background: #fffaf0; border: 1px solid #f0d9a8; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 60; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 480px; max-width: 92vw; }
.form-item { display: block; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
.hint-text { color: var(--muted); font-size: 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
