<template>
  <div>
    <div
      v-if="visible"
      class="mt-tag-layer"
      :style="layerStyle"
      @mousedown.self.prevent="onBackdropMouseDown"
    >
      <div
        ref="card"
        class="mt-tag-card"
        :style="cardStyle"
        @mousedown.stop
      >
        <div :style="titleStyle">
          {{ t('tagPopover.title') }}
        </div>
        <el-input
          ref="inputRef"
          v-model="draft"
          size="large"
          :placeholder="t('tagPopover.placeholder')"
          @keydown.enter.prevent="confirm"
        />
        <div :style="hintStyle">
          {{ t('tagPopover.hint') }}
        </div>
        <div :style="actionsStyle">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ElInput } from 'element-plus'

const { t } = useI18n()

const visible = ref(false)
const draft = ref('')
const card = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof ElInput> | null>(null)

// The native context menu takes focus away, and Muya re-renders the block when
// that happens; capture the editable element and the caret while the DOM is
// still live so the tag text can be inserted afterwards.
let savedEditor: HTMLElement | null = null
let savedRange: Range | null = null
let openedAt = 0

const report = (message: string): void => {
  try {
    window.electron.ipcRenderer.send('mt::tag::log', message)
  } catch {
    // Diagnostics must never break the feature.
  }
}

// A dimmed full-window layer cannot be missed regardless of where the caret is
// or which stacking context the editor lives in.
const layerStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 2147483647,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const
}

const cardStyle = {
  width: '420px',
  padding: '18px',
  boxSizing: 'border-box' as const,
  borderRadius: '10px',
  border: '2px solid #21b56f',
  background: '#ffffff',
  color: '#333333',
  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.35)'
}

const titleStyle = { fontSize: '15px', fontWeight: 600, marginBottom: '12px' }
const hintStyle = { marginTop: '10px', fontSize: '12px', lineHeight: 1.5, color: '#777777' }
const actionsStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '14px'
}

const editorFromNode = (node: Node | null): HTMLElement | null => {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return (element?.closest('.mu-editor') as HTMLElement | null) ?? null
}

const captureCaret = (): void => {
  try {
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const editor =
      editorFromNode(range?.startContainer ?? null) ?? editorFromNode(document.activeElement)
    if (editor) savedEditor = editor
    if (range) savedRange = range
  } catch {
    // Keep the previously captured caret when the selection is detached.
  }
}

const open = (): void => {
  try {
    captureCaret()
    openedAt = Date.now()
    draft.value = ''
    visible.value = true
    requestAnimationFrame(() => {
      inputRef.value?.focus()
      const element = card.value
      if (!element) {
        report('card element missing after open')
        return
      }
      const box = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      report(
        `card rect=${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} ` +
          `viewport=${window.innerWidth}x${window.innerHeight} display=${style.display} ` +
          `visibility=${style.visibility} opacity=${style.opacity} zIndex=${style.zIndex}`
      )
    })
  } catch (error) {
    report(`open failed: ${error instanceof Error ? error.message : String(error)}`)
  }
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
    // Range became invalid (block re-rendered); fall back to the editor caret.
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
    const inserted = document.execCommand('insertText', false, `${payload} `)
    if (!inserted) report(`insert rejected: ${payload}`)
  } catch (error) {
    report(`insert failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const close = (): void => {
  if (!visible.value) return
  if (Date.now() - openedAt < 300) return
  visible.value = false
  restoreCaret()
}

const onBackdropMouseDown = (): void => {
  if (Date.now() - openedAt < 300) return
  close()
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

let stopIpcListener: (() => void) | null = null

onMounted(() => {
  stopIpcListener = window.electron.ipcRenderer.on('mt::cm-insert-tag', () => open())
  document.addEventListener('contextmenu', onDocumentContextMenu, true)
  document.addEventListener('keydown', onDocumentKeyDown, true)
  report('popover component mounted')
})

onUnmounted(() => {
  stopIpcListener?.()
  document.removeEventListener('contextmenu', onDocumentContextMenu, true)
  document.removeEventListener('keydown', onDocumentKeyDown, true)
})
</script>
