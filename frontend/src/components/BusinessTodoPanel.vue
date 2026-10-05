<template>
  <section class="todo-panel">
    <header class="panel-head">
      <h3 class="sub-title">业务待办清单（位移监测）</h3>
      <span class="hint">与位移台账同属一份数据，任何入口处置都同步生效</span>
    </header>

    <p v-if="message" class="note-text">{{ message }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <div class="todo-filter">
      <label class="check"><input v-model="kindFilter" type="radio" value="" /> 全部（{{ todos.length }}）</label>
      <label class="check"><input v-model="kindFilter" type="radio" value="位移超限处置" /> 超限处置（{{ countOf('位移超限处置') }}）</label>
      <label class="check"><input v-model="kindFilter" type="radio" value="观测日期补录" /> 日期补录（{{ countOf('观测日期补录') }}）</label>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>类型</th><th>事项</th><th>测点/测次</th><th>归属月份</th><th>提出时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="todo in filteredTodos" :key="todo.id" :class="{ 'row-warn': todo.kind === '位移超限处置' }">
          <td><span class="tag" :class="todo.kind === '位移超限处置' ? 'over' : 'inferred'">{{ todo.kind }}</span></td>
          <td>
            <strong>{{ todo.title }}</strong>
            <div class="detail">{{ todo.detail }}</div>
          </td>
          <td>{{ todo.pointCode }} / {{ todo.roundNo }}</td>
          <td>{{ todo.month ?? '日期缺失（待补录）' }}</td>
          <td>{{ todo.createdAt }}</td>
          <td class="row-actions"><button class="link" type="button" @click="askResolve(todo)">处置完成</button></td>
        </tr>
        <tr v-if="!filteredTodos.length">
          <td colspan="6" class="empty-state">暂无待办</td>
        </tr>
      </tbody>
    </table>

    <div v-if="target" class="modal-mask" @click.self="target = null">
      <form class="modal small" @submit.prevent="confirmResolve">
        <h3 class="sub-title">处置待办：{{ target.title }}</h3>
        <label class="form-item">
          <span>处置说明 / 复核结论</span>
          <textarea v-model="handleNote" rows="3" placeholder="例如：现场复核为温度变形，连续两测次回落，超限解除"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认处置</button>
          <button class="btn ghost" type="button" @click="target = null">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { openTodos, resolveTodo } from '@/domain/displacement/service'
import type { TodoItem } from '@/domain/displacement/types'

const session = useSessionStore()
const todos = computed(() => openTodos())
const kindFilter = ref('')

const filteredTodos = computed(() =>
  todos.value.filter((todo) => !kindFilter.value || todo.kind === kindFilter.value),
)
function countOf(kind: TodoItem['kind']): number {
  return todos.value.filter((todo) => todo.kind === kind).length
}

const target = ref<TodoItem | null>(null)
const handleNote = ref('')
const message = ref('')
const errorMessage = ref('')

function askResolve(todo: TodoItem) {
  target.value = todo
  handleNote.value = ''
  errorMessage.value = ''
}
function confirmResolve() {
  if (!target.value) {
    return
  }
  try {
    resolveTodo(target.value.id, handleNote.value, session.operator)
    message.value = `待办「${target.value.title}」已处置，超限记录同步关闭。`
    target.value = null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '处置失败'
  }
}
</script>

<style scoped>
.todo-panel { margin-top: 16px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; }
.sub-title { font-size: 14px; margin: 10px 0; }
.hint { color: var(--muted); font-size: 12px; }
.note-text { color: #17663a; background: #edf9f1; border: 1px solid #b7e4c7; border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.todo-filter { display: flex; gap: 16px; margin-bottom: 8px; font-size: 13px; }
.check { display: flex; align-items: center; gap: 4px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.tag.over { background: #fde8e6; color: #b42318; }
.tag.inferred { background: #eef2f7; color: var(--muted); }
.row-warn { background: #fff7f6; }
.detail { color: var(--muted); font-size: 12px; margin-top: 2px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 60; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 560px; max-width: 92vw; }
.modal.small { width: 520px; }
.form-item { display: block; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-family: inherit; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
