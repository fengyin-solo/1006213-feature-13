<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="panel todo-panel">
      <h3 class="panel-title">
        位移观测台账
        <RouterLink class="inline-link" to="/displacement">进入台账</RouterLink>
        <RouterLink class="inline-link" to="/duty">监测值班</RouterLink>
      </h3>
      <div class="stat-row" style="margin-bottom:0">
        <article class="stat-card">
          <span class="stat-label">测点总数</span>
          <strong class="stat-value">{{ displacementStats.points }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前超限测点</span>
          <strong class="stat-value" :class="{ 'danger-text': displacementStats.overLimit }">
            {{ displacementStats.overLimit }}
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">开放超限待办</span>
          <strong class="stat-value" :class="{ 'danger-text': displacementStats.todos }">
            {{ displacementStats.todos }}
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">纸档待核测次</span>
          <strong class="stat-value">{{ displacementStats.paper }}</strong>
        </article>
      </div>
      <p class="hint">累计位移由水平/垂直位移按允许位移比例统一重算，页面、导出、月报、备品备件待办同属一份准据。</p>
    </section>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { getLedger, openTodos } from '@/data/displacement/store'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

const displacementStats = reactive({ points: 0, overLimit: 0, todos: 0, paper: 0 })

function refreshDisplacement() {
  const { state, views } = getLedger()
  displacementStats.points = state.points.length
  displacementStats.overLimit = views.filter((row) => row.overLimit).length
  displacementStats.todos = openTodos().length
  displacementStats.paper = new Set(
    state.observations.filter((obs) => obs.dateSource === 'paper').map((obs) => obs.sessionCode),
  ).size
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  refreshDisplacement()
}

onMounted(refresh)
</script>
