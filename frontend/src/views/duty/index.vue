<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>监测值班 · 位移超限处置</h2>
        <p class="page-desc">
          这里看到的超限记录由位移台账自动写入：测点合位移超过允许位移即自动标超限并生成待办，办结、重导覆盖都会与位移页、备品备件页同步。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">刷新</button>
        <button class="btn primary" type="button" @click="exportMonthly">导出监测月报（CSV）</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">开放超限待办</span>
        <strong class="stat-value" :class="{ 'danger-text': openTodoList.length }">{{ openTodoList.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">本月超限</span>
        <strong class="stat-value" :class="{ 'danger-text': thisMonthCount }">{{ thisMonthCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计超限观测</span>
        <strong class="stat-value">{{ monthly.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已办结留痕</span>
        <strong class="stat-value">{{ closedCount }}</strong>
      </article>
    </div>

    <section class="panel todo-panel">
      <h3 class="panel-title">待处置超限</h3>
      <p v-if="!openTodoList.length" class="hint">暂无开放超限待办。</p>
      <article v-for="todo in openTodoList" :key="todo.id" class="todo-card">
        <p class="todo-title">
          #{{ todo.id }} {{ todo.title }}
          <span class="badge badge-danger">占比 {{ (todo.ratio * 100).toFixed(1) }}%</span>
          <span class="badge">观测日期 {{ todo.obsDate }}</span>
        </p>
        <p class="todo-detail">{{ todo.detail }}</p>
        <div class="todo-actions">
          <button class="btn primary" type="button" @click="finish(todo.id)">确认处置，办结留痕</button>
          <RouterLink class="link" to="/displacement">去位移台账核对该测次</RouterLink>
          <RouterLink class="link" to="/spare">转备品备件/备件处置</RouterLink>
        </div>
      </article>
    </section>

    <section class="panel">
      <h3 class="panel-title">监测月报（按观测月份汇总超限记录）</h3>
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>月份筛选</span>
          <input v-model="monthFilter" placeholder="如 2026-09" style="width: 160px" />
        </label>
        <span class="hint">纸档待核的早期测次不进月报，补录日期转正后才计入。</span>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>月份</th><th>观测日期</th><th>测点编号</th><th>测次</th>
            <th>累计位移(mm)</th><th>允许位移(mm)</th><th>占比</th><th>标记</th><th>待办状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in filteredMonthly" :key="row.month + row.sessionCode + row.pointCode" :class="{ 'row-danger': true }">
            <td>{{ row.month }}</td>
            <td>{{ row.obsDate }}</td>
            <td>{{ row.pointCode }}</td>
            <td>{{ row.sessionCode }}</td>
            <td>{{ row.resultantMm }}</td>
            <td>{{ row.allowable }}</td>
            <td>{{ (row.ratio * 100).toFixed(1) }}%</td>
            <td><span class="badge badge-danger">超限</span></td>
            <td>
              <span v-if="todoStatusOf(row) === 'closed'" class="badge badge-ok">已办结</span>
              <span v-else-if="todoStatusOf(row) === 'stale'" class="badge badge-warn">已转留痕（重导不超限）</span>
              <span v-else class="badge badge-danger">待处置</span>
            </td>
          </tr>
          <tr v-if="!filteredMonthly.length">
            <td colspan="9" class="empty-state">该月份没有超限记录</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  closeTodo,
  downloadFile,
  exportMonthlyCsv,
  getLedger,
  monthlyOverlimits,
  openTodos,
  type MonthlyOverlimit,
} from '@/data/displacement/store'
import type { TodoItem } from '@/data/displacement/types'

const openTodoList = ref<TodoItem[]>([])
const monthly = ref<MonthlyOverlimit[]>([])
const allTodos = ref<TodoItem[]>([])
const monthFilter = ref('')

const thisMonth = new Date().toISOString().slice(0, 7)
const thisMonthCount = computed(() => monthly.value.filter((row) => row.month === thisMonth).length)
const closedCount = computed(() => allTodos.value.filter((todo) => todo.status === 'closed').length)

const filteredMonthly = computed(() =>
  monthFilter.value.trim()
    ? monthly.value.filter((row) => row.month.startsWith(monthFilter.value.trim()))
    : monthly.value,
)

function todoStatusOf(row: MonthlyOverlimit): 'open' | 'closed' | 'stale' {
  const todo = allTodos.value.find((t) => t.sessionCode === row.sessionCode && t.pointCode === row.pointCode)
  if (!todo) return 'stale'
  if (todo.status === 'closed') return 'closed'
  return todo.stale ? 'stale' : 'open'
}

function refresh() {
  openTodoList.value = openTodos()
  monthly.value = monthlyOverlimits()
  allTodos.value = getLedger().state.todos.slice().sort((a, b) => b.id - a.id)
}

function finish(id: number) {
  closeTodo(id)
  refresh()
}

function exportMonthly() {
  downloadFile(exportMonthlyCsv())
}

onMounted(refresh)
</script>
