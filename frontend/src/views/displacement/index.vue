<template>
  <section class="page" data-module="displacement">
    <header class="page-head">
      <div>
        <h2>位移观测台账</h2>
        <p class="page-desc">
          按测次整批导入外业成果，逐行核对测点编号 / 测点高程 / 观测日期；校验不过的行进另册写清缘由，其余照常入库。
          累计位移由水平、垂直位移按允许位移比例自动重算，超限自动写入监测月报与业务待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openImport">按测次导入外业文件</button>
        <button class="btn" type="button" @click="doDownloadTemplate">下载导入模板</button>
        <button class="btn" type="button" @click="doExportObservations">导出观测成果</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">现行测次数</span>
        <strong class="stat-value">{{ roundList.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">现行观测行</span>
        <strong class="stat-value">{{ observations.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未关闭超限</span>
        <strong class="stat-value" :class="{ 'warn-text': openAlertCount > 0 }">{{ openAlertCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待办（处置/补录）</span>
        <strong class="stat-value" :class="{ 'warn-text': openTodoCount > 0 }">{{ openTodoCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">校验另册</span>
        <strong class="stat-value">{{ rejectRows.length }}</strong>
      </article>
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <p v-if="message" class="note-text">{{ message }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <!-- 观测成果 -->
    <div v-if="activeTab === 'observations'">
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>测次</span>
          <select v-model="roundFilter">
            <option value="">全部测次</option>
            <option v-for="item in roundList" :key="item.roundNo" :value="item.roundNo">
              {{ item.roundNo }}{{ item.observedAt ? `（${item.observedAt}）` : '（日期缺失）' }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>测点编号</span>
          <input v-model="pointFilter" placeholder="按测点编号检索" />
        </label>
        <label class="filter-item check">
          <input v-model="onlyOverLimit" type="checkbox" /> 只看超限
        </label>
        <button class="btn" type="button" @click="doExportObservations">导出当前结果</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>测次</th><th>测点编号</th><th>测点部位</th><th>观测高程(m)</th>
            <th>水平(mm)</th><th>垂直(mm)</th><th>累计位移(mm)</th><th>允许(mm)</th>
            <th>占允许比例</th><th>观测日期</th><th>超限标记</th><th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredObservations" :key="row.id" :class="{ 'row-warn': row.overLimit }">
            <td>{{ row.roundNo }}</td>
            <td>{{ row.pointCode }}</td>
            <td>{{ pointMap.get(row.pointCode)?.section ?? '—' }}</td>
            <td>{{ row.elevationObserved }}</td>
            <td>{{ row.dx }}</td>
            <td>{{ row.dy }}</td>
            <td><strong>{{ row.cumulative }}</strong></td>
            <td>{{ pointMap.get(row.pointCode)?.allowable ?? '—' }}</td>
            <td :class="row.overLimit ? 'warn-text' : ''">{{ row.ratio === Infinity ? '∞' : row.ratio + '%' }}</td>
            <td>
              {{ row.observedAt ?? '日期缺失' }}
              <span v-if="row.dateInferred" class="tag inferred">按序推定</span>
            </td>
            <td>
              <span :class="row.overLimit ? 'tag over' : 'tag ok'">{{ row.overLimit ? '超限' : '正常' }}</span>
            </td>
            <td>{{ row.source === 'legacy' ? '存量迁移' : '导入' }}</td>
          </tr>
          <tr v-if="!filteredObservations.length">
            <td colspan="12" class="empty-state">暂无符合条件的观测行</td>
          </tr>
        </tbody>
      </table>
      <p class="hint-text">
        累计位移 = √(水平² + 垂直²)，比例 = 累计位移 ÷ 允许位移 ×100%，比例 ≥ 100% 自动标超限；页面、导出文件、月报同源。
      </p>
    </div>

    <!-- 测点台账 -->
    <div v-else-if="activeTab === 'points'">
      <div class="section-actions">
        <button class="btn primary" type="button" @click="editPoint(null)">新增测点</button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>测点编号</th><th>测点部位</th><th>台账高程(m)</th><th>允许位移(mm)</th><th>现行超限测次</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="point in points" :key="point.id">
            <td>{{ point.code }}</td>
            <td>{{ point.section }}</td>
            <td>{{ point.elevation }}</td>
            <td>{{ point.allowable }}</td>
            <td>
              <span v-for="code in openRoundsOf(point.code)" :key="code" class="tag over">{{ code }}</span>
              <span v-if="openRoundsOf(point.code).length === 0" class="tag ok">无</span>
            </td>
            <td>{{ point.updatedAt }}</td>
            <td class="row-actions"><button class="link" type="button" @click="editPoint(point)">修改</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 校验另册 -->
    <div v-else-if="activeTab === 'rejects'">
      <div class="section-actions">
        <button class="btn" type="button" @click="doExportRejects">另存校验另册</button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>批次</th><th>测次</th><th>测点编号</th><th>类别</th><th>缘由</th><th>原始行</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rejectRows" :key="row.id" :class="{ 'row-dup': row.category === '重复登记' }">
            <td>{{ row.occurredAt }}</td>
            <td>{{ row.batchId }}</td>
            <td>{{ row.roundNo }}</td>
            <td>{{ row.pointCode }}</td>
            <td><span class="tag" :class="row.category === '重复登记' ? 'dup' : 'reject'">{{ row.category }}</span></td>
            <td>{{ row.reason }}</td>
            <td class="raw-cell">{{ row.rawLine }}</td>
          </tr>
          <tr v-if="!rejectRows.length">
            <td colspan="7" class="empty-state">校验另册为空</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 批次与审计 -->
    <div v-else>
      <h3 class="sub-title">导入批次（同一测次以最后一次为准，旧版留痕）</h3>
      <table class="data-table">
        <thead>
          <tr><th>批次</th><th>测次</th><th>文件</th><th>导入时间</th><th>入库</th><th>另册</th><th>重复</th><th>覆盖批次</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="batch in batchList" :key="batch.id">
            <td>{{ batch.id }}</td>
            <td>{{ batch.roundNo }}</td>
            <td>{{ batch.fileName }}</td>
            <td>{{ batch.importedAt }}</td>
            <td>{{ batch.acceptedCount }}</td>
            <td>{{ batch.rejectedCount }}</td>
            <td>{{ batch.duplicateCount }}</td>
            <td>{{ batch.replacedBatchId ?? '—' }}</td>
            <td>{{ batch.note }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="sub-title">审计留痕（另一套结论仅留痕，不作准）</h3>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>操作人</th><th>动作</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in auditEntries" :key="entry.id">
            <td>{{ entry.at }}</td>
            <td>{{ entry.actor }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.detail }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="importOpen" class="modal-mask" @click.self="closeImport">
      <div class="modal">
        <h3 class="sub-title">按测次导入外业观测成果</h3>
        <p class="hint-text">
          支持 CSV / TXT / TSV（逗号、制表符、空白分隔均可）；表头可写“测次编号,测点编号,测点高程,水平位移,垂直位移,观测日期”，
          无表头时按此固定列序解析。空观测日期视为早期纸质记录（按测次顺序推定、挂补录待办）；累计位移列不需要填，系统自动重算。
        </p>
        <div class="import-controls">
          <label class="btn">
            选择文件
            <input type="file" accept=".csv,.txt,.tsv" hidden @change="onFileChange" />
          </label>
          <span class="file-name">{{ importFileName || '尚未选择文件，可直接粘贴文本' }}</span>
        </div>
        <textarea
          v-model="importText"
          class="import-textarea"
          rows="8"
          placeholder="测次编号,测点编号,测点高程,水平位移,垂直位移,观测日期&#10;R04,DISP-01,845.00,15.2,-10.4,2026-10-05"
        ></textarea>

        <div v-if="preview" class="preview-wrap">
          <p class="note-text">
            本批涉及测次 {{ preview.touchedRounds.join('、') || '（无）' }}：
            可入库 {{ preview.accepted.filter((i) => !i.duplicate).length }} 行，
            重复登记 {{ preview.accepted.filter((i) => i.duplicate).length }} 行，
            校验不过 {{ preview.rejected.filter((i) => !i.duplicate).length }} 行。
            同一测次已有数据将被本版整笔覆盖（旧版留痕，不叠加）。
          </p>
          <table v-if="preview.accepted.length" class="data-table mini">
            <thead>
              <tr><th>行</th><th>测次</th><th>测点</th><th>高程</th><th>水平</th><th>垂直</th><th>累计</th><th>比例</th><th>日期</th><th>判定</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in preview.accepted" :key="item.lineNo" :class="{ 'row-dup': item.duplicate, 'row-warn': item.overLimit }">
                <td>{{ item.lineNo }}</td><td>{{ item.roundNo }}</td><td>{{ item.pointCode }}</td>
                <td>{{ item.elevationObserved }}</td><td>{{ item.dx }}</td><td>{{ item.dy }}</td>
                <td>{{ item.cumulative }}</td>
                <td :class="item.overLimit ? 'warn-text' : ''">{{ item.ratio === Infinity ? '∞' : item.ratio + '%' }}</td>
                <td>{{ item.observedAt ?? '日期缺失' }}</td>
                <td>
                  <span v-if="item.duplicate" class="tag dup">重复·只认首次</span>
                  <span v-else :class="item.overLimit ? 'tag over' : 'tag ok'">{{ item.overLimit ? '超限' : '通过' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <table v-if="preview.rejected.length" class="data-table mini">
            <thead><tr><th>行</th><th>测次</th><th>测点</th><th>缘由</th></tr></thead>
            <tbody>
              <tr v-for="item in preview.rejected" :key="item.lineNo">
                <td>{{ item.lineNo }}</td><td>{{ item.roundNo }}</td><td>{{ item.pointCode }}</td>
                <td class="error-text">{{ item.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="btn" type="button" @click="buildPreview">核对解析</button>
          <button class="btn primary" type="button" :disabled="!preview" @click="confirmImport">确认入库（整笔事务）</button>
          <button class="btn ghost" type="button" @click="closeImport">取消</button>
        </div>
      </div>
    </div>

    <!-- 测点编辑弹窗 -->
    <div v-if="pointFormOpen" class="modal-mask" @click.self="closePointForm">
      <form class="modal" @submit.prevent="submitPoint">
        <h3 class="sub-title">{{ pointForm.id ? '修改测点' : '新增测点' }}</h3>
        <label class="form-item"><span>测点编号</span><input v-model="pointForm.code" required /></label>
        <label class="form-item"><span>测点部位</span><input v-model="pointForm.section" /></label>
        <label class="form-item"><span>台账高程(m)</span><input v-model.number="pointForm.elevation" type="number" step="0.01" required /></label>
        <label class="form-item"><span>允许位移(mm)</span><input v-model.number="pointForm.allowable" type="number" step="0.1" min="0" required /></label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存（超限记录联动重算）</button>
          <button class="btn ghost" type="button" @click="closePointForm">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import {
  auditLog,
  batches,
  commitImport,
  db,
  download,
  exportObservations,
  exportRejects,
  importTemplate,
  liveObservations,
  openAlerts,
  openTodos,
  previewImport,
  rejectLog,
  rounds,
  savePoint,
  type ImportPreview,
} from '@/domain/displacement/service'
import type { DisplacementPoint } from '@/domain/displacement/types'

const session = useSessionStore()

const tabs = [
  { key: 'observations', label: '观测成果' },
  { key: 'points', label: '测点台账' },
  { key: 'rejects', label: `校验另册` },
  { key: 'batches', label: '批次与留痕' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('observations')

const observations = computed(() => liveObservations())
const roundList = computed(() => rounds())
const rejectRows = computed(() => rejectLog())
const batchList = computed(() => batches())
const auditEntries = computed(() => auditLog())
const openAlertCount = computed(() => openAlerts().length)
const openTodoCount = computed(() => openTodos().length)
const pointMap = computed<Map<string, DisplacementPoint>>(
  () => new Map(db().points.map((point) => [point.code, point])),
)
const points = computed(() => db().points)

const roundFilter = ref('')
const pointFilter = ref('')
const onlyOverLimit = ref(false)

const filteredObservations = computed(() =>
  observations.value.filter(
    (row) =>
      (!roundFilter.value || row.roundNo === roundFilter.value) &&
      (!pointFilter.value || row.pointCode.includes(pointFilter.value.trim().toUpperCase())) &&
      (!onlyOverLimit.value || row.overLimit),
  ),
)

function openRoundsOf(code: string): string[] {
  return [...new Set(openAlerts().filter((alert) => alert.pointCode === code).map((alert) => alert.roundNo))]
}

const message = ref('')
const errorMessage = ref('')
function flash(text: string, isError = false) {
  if (isError) {
    errorMessage.value = text
    message.value = ''
  } else {
    message.value = text
    errorMessage.value = ''
  }
}

// 导入
const importOpen = ref(false)
const importText = ref('')
const importFileName = ref('')
const preview = ref<ImportPreview | null>(null)

function openImport() {
  importOpen.value = true
  importText.value = ''
  importFileName.value = ''
  preview.value = null
  errorMessage.value = ''
}
function closeImport() {
  importOpen.value = false
}
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  importFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result ?? '')
    buildPreview()
  }
  reader.readAsText(file, 'utf-8')
}
function buildPreview() {
  errorMessage.value = ''
  if (!importText.value.trim()) {
    flash('导入内容为空', true)
    preview.value = null
    return
  }
  preview.value = previewImport(importText.value, importFileName.value || '粘贴文本')
}
function confirmImport() {
  if (!preview.value) {
    return
  }
  try {
    const result = commitImport(preview.value, session.operator)
    const names = result.batches.map((batch) => batch.roundNo).join('、')
    flash(
      `导入完成：测次 ${names}，入库 ${result.acceptedCount} 行，另册 ${result.rejectedCount} 行` +
        `（重复登记 ${result.duplicateCount} 行只认首次取值）；超限记录与待办已联动。`,
    )
    importOpen.value = false
  } catch (error) {
    flash(error instanceof Error ? error.message : '导入失败，整笔退回', true)
  }
}

function doDownloadTemplate() {
  const file = importTemplate()
  download(file.filename, file.content)
}
function doExportObservations() {
  const file = exportObservations(roundFilter.value || undefined)
  download(file.filename, file.content)
}
function doExportRejects() {
  const file = exportRejects()
  download(file.filename, file.content)
}

// 测点维护
const pointFormOpen = ref(false)
const pointForm = ref({ id: '', code: '', section: '', elevation: 0, allowable: 0 })
function editPoint(point: DisplacementPoint | null) {
  errorMessage.value = ''
  pointFormOpen.value = true
  pointForm.value = point
    ? { id: point.id, code: point.code, section: point.section, elevation: point.elevation, allowable: point.allowable }
    : { id: '', code: '', section: '', elevation: 0, allowable: 0 }
}
function closePointForm() {
  pointFormOpen.value = false
}
function submitPoint() {
  try {
    savePoint({ ...pointForm.value }, session.operator)
    flash(`测点 ${pointForm.value.code} 已保存，累计比例与超限记录已在同一事务里重算。`)
    pointFormOpen.value = false
  } catch (error) {
    flash(error instanceof Error ? error.message : '测点保存失败，整笔退回', true)
  }
}
</script>

<style scoped>
.warn-text { color: #b42318; font-weight: 600; }
.note-text { color: #17663a; background: #edf9f1; border: 1px solid #b7e4c7; border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.hint-text { color: var(--muted); font-size: 12px; margin-top: 6px; }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.tag.ok { background: #e6f4ea; color: #17663a; }
.tag.over { background: #fde8e6; color: #b42318; }
.tag.reject { background: #fde8e6; color: #b42318; }
.tag.dup { background: #fff4e0; color: #9a5b00; }
.tag.inferred { background: #eef2f7; color: var(--muted); margin-left: 4px; }
.row-warn { background: #fff7f6; }
.row-dup { background: #fffaf0; }
.raw-cell { color: var(--muted); font-size: 12px; }
.section-actions { margin-bottom: 8px; }
.sub-title { font-size: 14px; margin: 14px 0 8px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-start; justify-content: center; padding: 32px 16px; overflow: auto; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 880px; max-width: 100%; }
.import-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.file-name { color: var(--muted); font-size: 12px; }
.import-textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-family: monospace; font-size: 12px; }
.preview-wrap { margin-top: 10px; max-height: 320px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
.data-table.mini th, .data-table.mini td { padding: 4px 8px; font-size: 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.form-item { display: block; margin-bottom: 10px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
.filter-item.check { display: flex; align-items: center; gap: 4px; font-size: 13px; }
</style>
