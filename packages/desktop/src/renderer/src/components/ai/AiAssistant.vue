<template>
  <Teleport to="body">
    <div
      v-if="assistant.open"
      class="ai-drawer"
      @keydown.esc.stop="close"
    >
      <header class="ai-header">
        <span class="ai-title">AI 助手</span>
        <div class="ai-tabs">
          <button
            :class="{ active: assistant.tab === 'result' }"
            @click="assistant.tab = 'result'"
          >
            结果
          </button>
          <button
            :class="{ active: assistant.tab === 'chat' }"
            @click="assistant.tab = 'chat'"
          >
            对话
          </button>
        </div>
        <button
          class="ai-close"
          @click="close"
        >
          ✕
        </button>
      </header>

      <div
        v-if="assistant.tab === 'result'"
        class="ai-body"
      >
        <div class="ai-meta">
          <span>{{ actionName }}</span>
          <span
            v-if="assistant.streaming"
            class="ai-streaming"
          >生成中…</span>
        </div>

        <p
          v-if="assistant.error"
          class="ai-error"
        >
          {{ assistant.error }}
        </p>

        <div class="ai-segments">
          <label
            v-for="(segment, index) in assistant.segments"
            :key="index"
            class="ai-segment"
            :class="{ muted: !segment.accepted }"
          >
            <input
              v-model="segment.accepted"
              type="checkbox"
            />
            <span>{{ segment.text }}</span>
          </label>
          <pre
            v-if="assistant.streaming && assistant.text"
            class="ai-stream"
          >{{ assistant.text }}</pre>
        </div>

        <footer class="ai-actions">
          <button
            v-if="assistant.streaming"
            @click="abort"
          >
            停止
          </button>
          <button
            v-if="assistant.segments.length"
            @click="toggleAll"
          >
            {{ allAccepted ? '全不选' : '全选' }}
          </button>
          <span class="spacer" />
          <button
            :disabled="!accepted"
            @click="insertAfter"
          >
            插入到光标
          </button>
          <button
            class="primary"
            :disabled="!accepted"
            @click="replaceSelection"
          >
            替换选区
          </button>
        </footer>
      </div>

      <div
        v-else
        class="ai-body chat"
      >
        <div class="ai-messages">
          <div
            v-for="(message, index) in assistant.messages"
            :key="index"
            class="ai-message"
            :class="message.role"
          >
            <div class="ai-message-text">
              {{ message.text }}
            </div>
            <button
              v-if="message.role === 'assistant'"
              class="ai-insert-mini"
              @click="insertMessage(message.text)"
            >
              插入到文档
            </button>
          </div>
          <div
            v-if="assistant.streaming && assistant.text"
            class="ai-message assistant"
          >
            <div class="ai-message-text">
              {{ assistant.text }}
            </div>
          </div>
          <p
            v-if="assistant.error"
            class="ai-error"
          >
            {{ assistant.error }}
          </p>
        </div>

        <div class="ai-chat-input">
          <el-input
            v-model="chatInput"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="问点什么，或让它基于选中内容改写…（Ctrl+Enter 发送）"
            @keydown.ctrl.enter.prevent="send"
          />
          <div class="ai-chat-actions">
            <el-checkbox v-model="withSelection">
              带上选中的文字
            </el-checkbox>
            <span class="spacer" />
            <button
              class="primary"
              :disabled="assistant.streaming || !chatInput.trim()"
              @click="send"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { assistant, abort, acceptedText } from '@/ai/assistant'
import { runChat } from '@/ai/actions'
import { applyAiText, insertAiText } from '@/ai/context'

const chatInput = ref('')
const withSelection = ref(true)

const actionName = computed(() => {
  const map: Record<string, string> = {
    polish: '润色',
    summarize: '总结',
    continue: '续写',
    translate: '翻译',
    chat: 'AI 建议'
  }
  return map[assistant.action] ?? 'AI'
})

const allAccepted = computed(
  () => assistant.segments.length > 0 && assistant.segments.every((segment) => segment.accepted)
)
const accepted = computed(() => acceptedText())

const close = (): void => {
  assistant.open = false
}

const toggleAll = (): void => {
  const next = !allAccepted.value
  for (const segment of assistant.segments) segment.accepted = next
}

const replaceSelection = (): void => {
  applyAiText(accepted.value)
  assistant.open = false
}

const insertAfter = (): void => {
  insertAiText(accepted.value)
  assistant.open = false
}

const insertMessage = (text: string): void => {
  insertAiText(text)
  assistant.open = false
}

const send = (): void => {
  const instruction = chatInput.value.trim()
  if (!instruction || assistant.streaming) return
  chatInput.value = ''
  runChat(instruction, withSelection.value)
}
</script>

<style scoped>
.ai-drawer {
  position: fixed;
  top: 48px;
  right: 12px;
  bottom: 12px;
  width: 420px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--floatBorderColor);
  border-radius: 10px;
  background: var(--floatBgColor);
  color: var(--editorColor);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.ai-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--floatBorderColor);
}

.ai-title {
  font-size: 13px;
  font-weight: 600;
}

.ai-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.ai-tabs button {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--editorColor80);
  cursor: pointer;
}

.ai-tabs button.active {
  border-color: var(--floatBorderColor);
  background: var(--floatHoverColor);
  color: var(--editorColor);
}

.ai-close {
  border: none;
  background: transparent;
  color: var(--editorColor80);
  cursor: pointer;
}

.ai-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px;
  gap: 8px;
}

.ai-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--editorColor80);
}

.ai-streaming {
  color: var(--themeColor);
}

.ai-error {
  margin: 0;
  font-size: 12px;
  color: #d9534f;
  white-space: pre-wrap;
}

.ai-segments {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-segment {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.6;
  padding: 6px 8px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  cursor: pointer;
}

.ai-segment.muted {
  opacity: 0.45;
  text-decoration: line-through;
}

.ai-segment input {
  margin-top: 4px;
}

.ai-stream {
  margin: 0;
  padding: 8px;
  font-size: 13px;
  white-space: pre-wrap;
  font-family: inherit;
  color: var(--editorColor80);
}

.ai-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 8px;
}

.ai-actions button,
.ai-chat-actions button,
.ai-insert-mini {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--floatBorderColor);
  background: transparent;
  color: var(--editorColor);
  cursor: pointer;
}

.ai-actions button.primary,
.ai-chat-actions button.primary {
  background: var(--themeColor);
  border-color: var(--themeColor);
  color: #fff;
}

.ai-actions button:disabled,
.ai-chat-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spacer {
  flex: 1;
}

.chat .ai-messages {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-message {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-width: 100%;
}

.ai-message.user {
  align-self: flex-end;
  background: var(--floatHoverColor);
}

.ai-message.assistant {
  background: var(--floatHoverColor);
}

.ai-insert-mini {
  margin-top: 6px;
  padding: 2px 8px;
}

.ai-chat-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
