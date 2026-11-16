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
          <button
            v-if="assistant.segments.length"
            @click="addToChat"
          >
            添加到对话
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
          <div
            v-if="assistant.chips.length"
            class="ai-chips"
          >
            <span
              v-for="chip in assistant.chips"
              :key="chip.id"
              class="ai-chip"
              :title="chip.type === 'text' ? chip.text : chip.label"
            >
              <img
                v-if="chip.type === 'image'"
                :src="chip.dataUrl"
                class="ai-chip-thumb"
                alt=""
              />
              <span v-else>{{ chip.label }}</span>
              <button
                class="ai-chip-x"
                title="移除"
                @click="removeChip(chip.id)"
              >
                ✕
              </button>
            </span>
          </div>

          <textarea
            ref="inputRef"
            v-model="chatInput"
            class="ai-input"
            rows="3"
            placeholder="问点什么，或把选中的文字/图片添加进来…（Ctrl+Enter 发送，Ctrl+V 粘贴图片）"
            @keydown.ctrl.enter.prevent="send"
            @paste="onPaste"
          />

          <div class="ai-chat-actions">
            <button
              class="ai-tool"
              title="把编辑器里最近一次选中的文字加到对话"
              @click="addSelectionChip"
            >
              + 添加选区
            </button>
            <button
              class="ai-tool"
              title="添加一张图片（也可以直接 Ctrl+V 粘贴）"
              @click="pickImage"
            >
              + 图片
            </button>
            <input
              ref="fileRef"
              type="file"
              accept="image/*"
              class="ai-file"
              @change="onFilePicked"
            />
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
import { computed, nextTick, ref } from 'vue'
import {
  assistant,
  abort,
  acceptedText,
  addImageChip,
  addTextChip,
  removeChip
} from '@/ai/assistant'
import { runChat } from '@/ai/actions'
import { applyAiText, insertAiText, lastSelection } from '@/ai/context'

const chatInput = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)

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

/** Send the accepted result into the chat as a context chip. */
const addToChat = (): void => {
  const text = accepted.value
  if (!text.trim()) return
  addTextChip(text, `AI 结果 · ${text.length} 字`)
  assistant.tab = 'chat'
  nextTick(() => inputRef.value?.focus())
}

const addSelectionChip = (): void => {
  const { text, label } = lastSelection()
  if (!addTextChip(text, `选区 · ${label || `${text.length} 字`}`)) {
    assistant.error = text ? '' : '没有可添加的选区，先在编辑器里选一段文字'
  }
  nextTick(() => inputRef.value?.focus())
}

const pickImage = (): void => fileRef.value?.click()

const readAsDataUrl = (file: File): void => {
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') addImageChip(reader.result, file.name || '图片')
  }
  reader.readAsDataURL(file)
}

const onFilePicked = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readAsDataUrl(file)
  input.value = ''
}

const onPaste = (event: ClipboardEvent): void => {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) {
      event.preventDefault()
      readAsDataUrl(file)
      return
    }
  }
}

const send = (): void => {
  const instruction = chatInput.value.trim()
  if (!instruction || assistant.streaming) return
  chatInput.value = ''
  runChat(instruction)
  nextTick(() => inputRef.value?.focus())
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
  gap: 6px;
  align-items: center;
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 8px;
  flex-wrap: wrap;
}

.ai-actions button,
.ai-chat-actions button,
.ai-tool,
.ai-insert-mini {
  font-size: 12px;
  padding: 4px 10px;
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

.ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 6px 3px 8px;
  font-size: 12px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  background: var(--floatHoverColor);
  color: var(--editorColor80);
}

.ai-chip-thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
}

.ai-chip-x {
  border: none;
  background: transparent;
  color: var(--editorColor50);
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
}

.ai-input {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  color: var(--editorColor);
  background: transparent;
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  outline: none;
}

.ai-input:focus {
  border-color: var(--themeColor);
}

.ai-chat-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-file {
  display: none;
}
</style>
