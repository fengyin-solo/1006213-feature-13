<template>
  <section class="page" data-module="displacement">
    <header class="page-head">
      <div>
        <h2>位移观测台账</h2>
        <p class="page-desc">
          外业成果按测次整批导入，逐行核对测点编号、测点高程与观测日期；累计位移由水平/垂直位移按允许位移比例自动重算，不接受手填。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="downloadTemplate">下载导入模板</button>
        <button class="btn primary" type="button" @click="exportCsv">另存观测成果（CSV）</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">测点总数</span>
        <strong class="stat-value">{{ views.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">当前超限测点</span>
        <strong class="stat-value" :class="{ 'danger-text': overCount > 0 }">{{ overCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">纸档待核测次</span>
        <strong class="stat-value">{{ paperCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">开放超限待办</span>
        <strong class="stat-value" :class="{ 'danger-text': todoCount > 0 }">
          {{ todoCount }}
          <RouterLink class="inline-link" to="/duty">去值班入口处理</RouterLink>
        </strong>
      </article>
    </div>

    <!-- 整批导入 -->
    <section class="panel">
      <h3 class="panel-title">按测次导入外业文件</h3>
      <div class="import-bar">
        <label class="file-pick">
          <input type="file" accept=".txt,.csv,.dat" @change="onFilePicked" />
          <span>{{ pickedFile ? pickedFile.name : '选择外业文本文件（.txt/.csv，逗号、Tab 或空格分隔均可）' }}</span>
        </label>
        <label class="filter-item">
          <span>测次号</span>
          <input v-model="sessionCode" placeholder="如 2026-10；文件抬头写了「测次：」可自动带出" style="width: 220px" />
        </label>
        <button class="btn primary" type="button" :disabled="!pickedFile || importing" @click="doImport">
          {{ importing ? '导入中…' : '整批导入' }}
        </button>
        <button class="btn ghost" type="button" @click="clearPicked">清空重选</button>
      </div>
      <p class="hint">
        规则：同一测次重导以最后一次整版覆盖；同一批次内同测点多行只认第一次；任一行核对不过会另摘到拒收清单并写明缘由，其余照常入库；
        文件若带「累计位移」列一律忽略，以系统重算为准。
      </p>
      <p v-if="importMessage" class="ok-text">{{ importMessage }}</p>
      <p v-if="importError" class="error-text">{{ importError }}（整笔退回，台账未改动）</p>

      <div v-if="lastOutcome" class="import-result">
        <p class="hint">
          本次入库 <strong>{{ lastOutcome.accepted }}</strong> 行，另摘
          <strong :class="{ 'danger-text': lastOutcome.rejected > 0 }">{{ lastOutcome.rejected }}</strong> 行
          <template v-if="lastOutcome.replacedSession">；该测次旧版本已整版覆盖，旧值留在导入留痕</template>
          <template v-if="lastOutcome.ignoredCumulativeColumn">；文件里的手填累计列已忽略</template>
        </p>
        <table v-if="lastOutcome.rejectedRows.length" class="data-table reject-table">
          <thead>
            <tr><th style="width:60px">行号</th><th style="width:120px">测点编号</th><th>拒收缘由</th><th>原文</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in lastOutcome.rejectedRows" :key="row.lineNo">
              <td>{{ row.lineNo }}</td>
              <td>{{ row.pointCode || '—' }}</td>
              <td class="danger-text">{{ row.reason }}</td>
              <td class="raw-line">{{ row.rawLine }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </nav>

    <!-- 测点现状：累计位移/超限标记全是重算值 -->
    <section v-show="activeTab === 'points'">
      <table class="data-table">
        <thead>
          <tr>
            <th>测点编号</th><th>测点高程(m)</th><th>允许位移(mm)</th><th>监测频次</th>
            <th>最新测次</th><th>观测日期</th>
            <th>水平位移(mm)</th><th>垂直位移(mm)</th>
            <th>累计位移(mm)</th><th>占允许位移</th><th>超限标记</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in views" :key="row.point.id" :class="{ 'row-danger': row.overLimit }">
            <td>{{ row.point.code }}</td>
            <td>{{ row.point.elevation }}</td>
            <td>{{ row.point.allowable }}</td>
            <td>{{ row.point.frequency }}</td>
            <td>{{ row.sessionCode ?? '—' }}</td>
            <td>
              {{ row.obsDate ?? '—' }}
              <span v-if="row.dateSource === 'paper'" class="badge badge-warn">纸档待核</span>
            </td>
            <td>{{ row.dx ?? '—' }}</td>
            <td>{{ row.dy ?? '—' }}</td>
            <td>{{ row.resultantMm ?? '—' }}</td>
            <td>{{ row.ratio === null ? '—' : (row.ratio * 100).toFixed(1) + '%' }}</td>
            <td>
              <span :class="row.overLimit ? 'badge badge-danger' : 'badge badge-ok'">
                {{ row.overLimit ? '超限' : '正常' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="hint">累计位移 = √(水平² + 垂直²)；占允许位移 = 累计位移 ÷ 允许位移，占比 &gt; 100% 自动判超限并写入监测月报与处置待办。</p>
    </section>

    <!-- 观测明细：按测次分组，纸档在此补录日期 -->
    <section v-show="activeTab === 'sessions'">
      <div v-for="session in sessionGroups" :key="session.sessionCode" class="session-block">
        <div class="session-head">
          <strong>测次 {{ session.sessionCode }}</strong>
          <span class="badge" :class="session.dateSource === 'paper' ? 'badge-warn' : 'badge-ok'">
            {{ session.dateSource === 'paper' ? '纸档待核（无观测日期）' : '观测日期 ' + session.obsDate }}
          </span>
          <span class="hint">{{ session.rows }} 个测点</span>
          <span v-if="session.overLimit" class="badge badge-danger">{{ session.overLimit }} 点超限</span>
          <span v-if="session.migrated" class="badge">存量迁移</span>
          <span v-else-if="session.importId" class="badge">导入批次 #{{ session.importId }}</span>
          <span v-if="session.dateSource === 'paper'" class="backfill">
            <input v-model="backfillDates[session.sessionCode]" placeholder="核对到的观测日期，如 2024-11-20" style="width: 200px" />
            <button class="btn" type="button" @click="doBackfill(session.sessionCode)">补录日期转正</button>
          </span>
        </div>
        <table class="data-table inner-table">
          <thead>
            <tr><th>测点编号</th><th>水平(mm)</th><th>垂直(mm)</th><th>累计(mm)</th><th>允许(mm)</th><th>占比</th><th>标记</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in session.lines" :key="line.pointCode + line.id" :class="{ 'row-danger': line.over }">
              <td>{{ line.pointCode }}</td>
              <td>{{ line.dx }}</td>
              <td>{{ line.dy }}</td>
              <td>{{ line.resultantMm }}</td>
              <td>{{ line.allowable }}</td>
              <td>{{ (line.ratio * 100).toFixed(1) }}%</td>
              <td>
                <span :class="line.over ? 'badge badge-danger' : 'badge badge-ok'">{{ line.over ? '超限' : '正常' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!sessionGroups.length" class="empty-state">暂无观测记录</p>
      <p class="hint">纸档补录原则：不臆造日期，核对到实际观测日期后整测次转正，原始读数保持原样；转正前不自动报超限、不进月报。</p>
    </section>

    <!-- 拒收清单 -->
    <section v-show="activeTab === 'rejects'">
      <table class="data-table">
        <thead>
          <tr><th style="width:60px">#</th><th style="width:110px">测次</th><th style="width:60px">行号</th><th style="width:120px">测点编号</th><th>拒收缘由</th><th>原文</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rejections" :key="row.id">
            <td>{{ row.id }}</td>
            <td>{{ row.sessionCode }}</td>
            <td>{{ row.lineNo }}</td>
            <td>{{ row.pointCode || '—' }}</td>
            <td class="danger-text">{{ row.reason }}</td>
            <td class="raw-line">{{ row.rawLine }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rejections.length" class="empty-state">暂无拒收记录</p>
    </section>

    <!-- 导入留痕：另一套结论只留痕 -->
    <section v-show="activeTab === 'trace'">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:50px">#</th><th style="width:110px">测次</th><th>文件</th><th style="width:150px">导入时间</th>
            <th style="width:70px">入库</th><th style="width:70px">另摘</th><th>版本状态</th><th style="width:90px">原文</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in imports" :key="batch.id" :class="{ 'row-muted': batch.superseded }">
            <td>{{ batch.id }}</td>
            <td>{{ batch.sessionCode }}</td>
            <td>{{ batch.fileName }}</td>
            <td>{{ formatTime(batch.importedAt) }}</td>
            <td>{{ batch.accepted }}</td>
            <td>{{ batch.rejected }}</td>
            <td>
              <span v-if="batch.superseded" class="badge badge-warn">已被后版覆盖（留痕）</span>
              <span v-else class="badge badge-ok">当前版本</span>
              <span v-if="batch.replacedSnapshot.length" class="badge">含旧版快照 {{ batch.replacedSnapshot.length }} 行</span>
              <span v-if="batch.ignoredCumulativeColumn" class="badge badge-warn">手填累计列已忽略</span>
            </td>
            <td><button class="link" type="button" @click="toggleRaw(batch.id)">查看原文</button></td>
          </tr>
          <tr v-for="batch in imports" v-show="openedRaw === batch.id" :key="'raw-' + batch.id">
            <td colspan="8"><pre class="raw-pre">{{ batch.rawText }}</pre></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!imports.length" class="empty-state">尚未导入过外业文件（当前为存量迁移数据）</p>
      <p class="hint">以系统重算的台账为准；外业原文与被覆盖旧版仅在此留痕，不参与统计。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { isOverLimit, ratioOf, resultant, round1 } from '@/data/displacement/calc'
import { parseFieldText } from '@/data/displacement/parser'
import {
  backfillSessionDate,
  downloadFile,
  exportObservationsCsv,
  getLedger,
  importSession,
  listImports,
  listPoints,
  listRejections,
  openTodos,
  type ViewRow,
} from '@/data/displacement/store'
import type { ImportOutcome } from '@/data/displacement/store'

type TabKey = 'points' | 'sessions' | 'rejects' | 'trace'

const views = ref<ViewRow[]>([])
const rejections = ref(getLedger().state.rejections)
const imports = ref(listImports())
const todoCount = ref(0)
const activeTab = ref<TabKey>('points')
const openedRaw = ref<number | null>(null)

const pickedFile = ref<File | null>(null)
const pickedText = ref('')
const sessionCode = ref('')
const importing = ref(false)
const importError = ref('')
const importMessage = ref('')
const lastOutcome = ref<ImportOutcome | null>(null)
const backfillDates = reactive<Record<string, string>>({})

const overCount = computed(() => views.value.filter((row) => row.overLimit).length)
const paperCount = computed(
  () => new Set(getLedger().state.observations.filter((o) => o.dateSource === 'paper').map((o) => o.sessionCode)).size,
)

const tabs = computed(() => [
  { key: 'points' as TabKey, label: '测点现状', badge: 0 },
  { key: 'sessions' as TabKey, label: '观测明细 / 纸档补录', badge: paperCount.value },
  { key: 'rejects' as TabKey, label: '核对拒收', badge: rejections.value.length },
  { key: 'trace' as TabKey, label: '导入留痕', badge: 0 },
])

interface SessionGroup {
  sessionCode: string
  obsDate: string | null
  dateSource: 'dated' | 'paper'
  rows: number
  overLimit: number
  migrated: boolean
  importId: number | null
  lines: Array<{ id: number; pointCode: string; dx: number; dy: number; resultantMm: number; allowable: number; ratio: number; over: boolean }>
}

const sessionGroups = computed<SessionGroup[]>(() => {
  const { state } = getLedger()
  const pointByCode = new Map(listPoints().map((p) => [p.code, p]))
  const map = new Map<string, SessionGroup>()
  state.observations.forEach((obs) => {
    const point = pointByCode.get(obs.pointCode)
    if (!point) return
    const ratio = ratioOf(obs.dx, obs.dy, point.allowable)
    const group =
      map.get(obs.sessionCode) ??
      ({
        sessionCode: obs.sessionCode,
        obsDate: obs.obsDate,
        dateSource: obs.dateSource,
        rows: 0,
        overLimit: 0,
        migrated: true,
        importId: obs.importId,
        lines: [],
      } as SessionGroup)
    group.rows += 1
    group.migrated = group.migrated && obs.migrated
    const over = isOverLimit(ratio)
    if (over) group.overLimit += 1
    group.lines.push({
      id: obs.id,
      pointCode: obs.pointCode,
      dx: obs.dx,
      dy: obs.dy,
      resultantMm: round1(resultant(obs.dx, obs.dy)),
      allowable: point.allowable,
      ratio,
      over,
    })
    map.set(obs.sessionCode, group)
  })
  return [...map.values()].sort((a, b) => {
    if (a.dateSource !== b.dateSource) return a.dateSource === 'paper' ? -1 : 1
    const da = a.obsDate ?? ''
    const db = b.obsDate ?? ''
    return da === db ? a.sessionCode.localeCompare(b.sessionCode) : da < db ? 1 : -1
  })
})

function refresh() {
  const data = getLedger()
  views.value = data.views
  rejections.value = [...data.state.rejections].sort((a, b) => b.id - a.id)
  imports.value = listImports()
  todoCount.value = openTodos().length
}

function onFilePicked(event: Event) {
  importError.value = ''
  importMessage.value = ''
  lastOutcome.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    pickedFile.value = null
    return
  }
  pickedFile.value = file
  const reader = new FileReader()
  reader.onload = () => {
    let text = String(reader.result ?? '')
    // UTF-8 解出大量替换符时多半是 GBK/GB2312 外业文件，用对应编码重读一次。
    const garbled = (text.match(/�/g) ?? []).length
    if (garbled >= 2) {
      try {
        text = new TextDecoder('gbk', { fatal: false }).decode(reader.result as ArrayBuffer)
      } catch {
        // 老环境不支持 gbk 时维持 UTF-8 结果，拒收清单会把不可读行另摘。
      }
    }
    pickedText.value = text
    // 预读抬头，帮值班员带出测次号；带不出来就手填。
    if (!sessionCode.value) {
      const preview = parseFieldText(pickedText.value)
      if (preview.sessionFromFile) sessionCode.value = preview.sessionFromFile
    }
  }
  reader.onerror = () => {
    importError.value = `文件读取失败：${reader.error?.message ?? '未知错误'}`
  }
  reader.readAsArrayBuffer(file)
}

function clearPicked() {
  pickedFile.value = null
  pickedText.value = ''
  sessionCode.value = ''
  importError.value = ''
  importMessage.value = ''
  lastOutcome.value = null
}

function doImport() {
  if (!pickedFile.value) return
  importing.value = true
  importError.value = ''
  importMessage.value = ''
  try {
    const outcome = importSession({
      sessionCode: sessionCode.value,
      fileName: pickedFile.value.name,
      rawText: pickedText.value,
    })
    lastOutcome.value = outcome
    importMessage.value = `测次 ${outcome.sessionCode} 导入完成。`
    refresh()
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '导入失败'
  } finally {
    importing.value = false
  }
}

function doBackfill(code: string) {
  const date = backfillDates[code]
  if (!date) {
    importError.value = `请先填写测次 ${code} 核对到的观测日期`
    return
  }
  try {
    backfillSessionDate(code, date)
    importMessage.value = `测次 ${code} 已按 ${date} 转正，原始读数未改动。`
    importError.value = ''
    delete backfillDates[code]
    refresh()
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '补录失败'
  }
}

function exportCsv() {
  downloadFile(exportObservationsCsv())
}

function toggleRaw(id: number) {
  openedRaw.value = openedRaw.value === id ? null : id
}

function formatTime(stamp: string): string {
  return stamp.replace('T', ' ').slice(0, 16)
}

function downloadTemplate() {
  const content = [
    '测次：2026-10',
    '观测日期：2026-10-15',
    '测点编号,测点高程,水平位移,垂直位移,观测日期',
    'DISP-0001,246.50,20.0,-9.0,2026-10-15',
    'DISP-0002,248.12,12.0,7.0,2026-10-15',
  ].join('\n')
  downloadFile({ filename: '位移观测成果-导入模板.txt', content: `﻿${content}` })
}

onMounted(refresh)
</script>
