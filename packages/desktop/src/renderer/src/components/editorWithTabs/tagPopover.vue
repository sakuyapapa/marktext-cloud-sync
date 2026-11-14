<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="tag-popover-layer"
      @mousedown.self.prevent="close"
    >
      <div
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
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ElInput } from 'element-plus'
import bus from '@/bus'

const { t } = useI18n()

const visible = ref(false)
const draft = ref('')
const card = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof ElInput> | null>(null)
const anchor = ref({ x: 24, y: 96 })

// The native context menu takes focus away, and some Electron builds drop the
// DOM selection while the menu is open. Capture both the editable element and
// the caret on `contextmenu` (which fires before the main process shows the
// menu) so the tag can still be inserted afterwards.
let savedEditor: HTMLElement | null = null
let savedRange: Range | null = null
let openedAt = 0

const positionStyle = computed(() => ({
  left: `${anchor.value.x}px`,
  top: `${anchor.value.y}px`
}))

const editorFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest('.mu-editor') as HTMLElement | null) ?? null
}

const captureCaret = (): void => {
  try {
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const editor = editorFromNode(range?.startContainer ?? null) ??
      editorFromNode(document.activeElement)
    if (editor) savedEditor = editor
    if (range) savedRange = range
  } catch {
    // A contextmenu on a detached node can make getRangeAt throw; keep the
    // previously captured caret instead.
  }
}

const open = (): void => {
  captureCaret()
  openedAt = Date.now()

  let rect: DOMRect | null = null
  try {
    rect = savedRange?.getBoundingClientRect() ?? null
  } catch {
    rect = null
  }

  const width = 300
  const height = 160
  const x = Math.max(8, Math.min(rect?.left ?? 24, window.innerWidth - width - 8))
  const y = rect
    ? rect.bottom + height > window.innerHeight
      ? Math.max(8, rect.top - height - 8)
      : rect.bottom + 8
    : 96
  anchor.value = { x, y }
  draft.value = ''
  visible.value = true
  requestAnimationFrame(() => inputRef.value?.focus())
}

const restoreCaret = (): void => {
  const editor = savedEditor
  if (!editor || !editor.isConnected) return
  editor.focus()
  const range = savedRange
  if (!range) return
  const selection = window.getSelection()
  if (!selection) return
  try {
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // Range became invalid (block re-rendered); fall back to the editor's caret.
  }
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
  restoreCaret()
  if (!payload) return
  try {
    // Muya handles the resulting `input` event, so inline formatting, the undo
    // stack and the markdown state all stay consistent with typed text.
    const inserted = document.execCommand('insertText', false, `${payload} `)
    if (!inserted) console.warn('[tag] insertText was rejected by the renderer')
  } catch (error) {
    console.warn('[tag] failed to insert tag text', error)
  }
}

const close = (): void => {
  if (!visible.value) return
  visible.value = false
  // Ignore the closing click of the native menu: it arrives right after the IPC
  // message and must not tear the editor focus away a second time.
  if (Date.now() - openedAt > 50) restoreCaret()
}

const onDocumentContextMenu = (): void => captureCaret()

const onDocumentKeyDown = (event: KeyboardEvent): void => {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 't') {
    event.preventDefault()
    if (visible.value) close()
    else open()
    return
  }
  if (event.key === 'Escape' && visible.value) {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  bus.on('insertTag', open)
  document.addEventListener('contextmenu', onDocumentContextMenu, true)
  document.addEventListener('keydown', onDocumentKeyDown, true)
})

onUnmounted(() => {
  bus.off('insertTag', open)
  document.removeEventListener('contextmenu', onDocumentContextMenu, true)
  document.removeEventListener('keydown', onDocumentKeyDown, true)
})
</script>

<style scoped>
.tag-popover-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.tag-popover {
  position: absolute;
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
