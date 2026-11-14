<template>
  <div
    v-if="visible"
    ref="card"
    class="tag-popover"
    :style="positionStyle"
    @mousedown.stop
    @keydown.esc.stop.prevent="close"
  >
    <div class="tag-popover__title">
      {{ t('tagPopover.title') }}
    </div>
    <el-input
      ref="inputRef"
      v-model="draft"
      size="small"
      class="tag-popover__input"
      :placeholder="t('tagPopover.placeholder')"
      @keydown.enter.prevent="confirm"
    />
    <div class="tag-popover__hint">
      {{ t('tagPopover.hint') }}
    </div>
    <div class="tag-popover__actions">
      <el-button
        size="small"
        @click="close"
      >
        {{ t('tagPopover.cancel') }}
      </el-button>
      <el-button
        size="small"
        type="primary"
        @click="confirm"
      >
        {{ t('tagPopover.confirm') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ElInput } from 'element-plus'
import bus from '@/bus'

const { t } = useI18n()

const visible = ref(false)
const draft = ref('')
const card = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof ElInput> | null>(null)
const anchor = ref({ x: 0, y: 0 })

// The popover steals DOM focus, so the caret inside the contenteditable has to
// be captured before it opens and replayed when the tags are inserted.
let savedRange: Range | null = null
let savedEditor: HTMLElement | null = null

const positionStyle = computed(() => ({
  left: `${anchor.value.x}px`,
  top: `${anchor.value.y}px`
}))

const editorFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest('.mu-editor') as HTMLElement | null) ?? null
}

const open = (): void => {
  const selection = window.getSelection()
  savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  savedEditor = editorFromNode(savedRange?.startContainer ?? null)

  const rect = savedRange?.getBoundingClientRect()
  const width = 300
  const estimatedHeight = 150
  const x = Math.max(8, Math.min(rect?.left ?? 24, window.innerWidth - width - 8))
  const y = rect
    ? rect.bottom + estimatedHeight > window.innerHeight
      ? Math.max(8, rect.top - estimatedHeight - 8)
      : rect.bottom + 8
    : 96
  anchor.value = { x, y }
  draft.value = ''
  visible.value = true
  nextTick(() => inputRef.value?.focus())
}

const restoreCaret = (): void => {
  const editor = savedEditor
  if (!editor) return
  editor.focus()
  const range = savedRange
  const selection = window.getSelection()
  if (!range || !selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/** `#tag` tokens, space separated; commas are accepted as separators too. */
const normaliseTags = (input: string): string =>
  input
    .split(/[,，、\s]+/)
    .map((tag) => tag.replace(/^#+/, '').trim())
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(' ')

const confirm = (): void => {
  const payload = normaliseTags(draft.value)
  visible.value = false
  if (!payload) {
    restoreCaret()
    return
  }
  restoreCaret()
  try {
    // Muya handles the resulting `input` event, so this keeps inline formatting,
    // the undo stack and the markdown state consistent.
    const inserted = document.execCommand('insertText', false, `${payload} `)
    if (!inserted) {
      console.warn('[tag] insertText was rejected by the renderer')
    }
  } catch (error) {
    console.warn('[tag] failed to insert tag text', error)
  }
}

const close = (): void => {
  if (!visible.value) return
  visible.value = false
  restoreCaret()
}

const onDocumentMouseDown = (event: MouseEvent): void => {
  if (!visible.value) return
  if (card.value && event.target instanceof Node && card.value.contains(event.target)) return
  close()
}

onMounted(() => {
  bus.on('insertTag', open)
  document.addEventListener('mousedown', onDocumentMouseDown, true)
})

onUnmounted(() => {
  bus.off('insertTag', open)
  document.removeEventListener('mousedown', onDocumentMouseDown, true)
})
</script>

<style scoped>
.tag-popover {
  position: fixed;
  z-index: 3000;
  width: 300px;
  padding: 12px;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--floatBorderColor);
  background: var(--floatBgColor);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  color: var(--editorColor);
}

.tag-popover__title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.tag-popover__input {
  width: 100%;
}

.tag-popover__hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--editorColor50);
  line-height: 1.4;
}

.tag-popover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
</style>
