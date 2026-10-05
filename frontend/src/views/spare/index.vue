<template>
  <section class="page" data-module="spare">
    <header class="page-head">
      <div>
        <h2>备品备件管理</h2>
        <p class="page-desc">备件台账与业务待办同页处置；位移超限结论会自动落到下面的处置待办，和监测值班入口打开的是同一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出备品备件清单</button>
      </div>
    </header>

    <!-- 位移超限处置待办：与监测值班页共用台账存储，办结同步生效 -->
    <section class="panel todo-panel">
      <h3 class="panel-title">
        位移超限处置待办
        <span class="badge" :class="openTodoList.length ? 'badge-danger' : 'badge-ok'">{{ openTodoList.length }} 条开放</span>
        <RouterLink class="inline-link" to="/duty">在监测值班入口查看/导出月报</RouterLink>
      </h3>
      <p v-if="!openTodoList.length" class="hint">当前没有开放的位移超限待办。超限判定随测次重导自动更新，不再成立的记录自动转留痕。</p>
      <article v-for="todo in openTodoList" :key="todo.id" class="todo-card">
        <p class="todo-title">
          #{{ todo.id }} {{ todo.title }}
          <span class="badge badge-danger">占比 {{ (todo.ratio * 100).toFixed(1) }}%</span>
          <span class="badge">{{ todo.obsDate }}</span>
        </p>
        <p class="todo-detail">{{ todo.detail }}</p>
        <div class="todo-actions">
          <button class="btn primary" type="button" @click="finish(todo.id)">已处置，办结</button>
          <RouterLink class="link" to="/displacement">去位移台账核对</RouterLink>
        </div>
      </article>
    </section>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无备品备件数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条备品备件记录；位移超限待办与监测值班、位移台账同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { closeTodo, openTodos } from '@/data/displacement/store'
import type { TodoItem } from '@/data/displacement/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('spare')
const columns = ["备件编号", "备件名称", "规格型号", "适用设备", "存放位置", "现有数量", "最低储备量", "备件状态"]
const statuses = ["待验收", "已登记", "已领用", "待补充"]
const stats = [{"label": "已登记备件", "value": 0}, {"label": "待补充备件", "value": 0}, {"label": "本月领用", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const openTodoList = ref<TodoItem[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function refreshTodos() {
  openTodoList.value = openTodos()
}

function finish(id: number) {
  closeTodo(id)
  refreshTodos()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '备品备件列表读取失败'
  }
}

onMounted(reload)
</script>
