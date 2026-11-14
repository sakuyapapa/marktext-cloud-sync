<template>
  <div>
    <div
      v-if="visible"
      class="mt-tag-backdrop"
      :style="backdropStyle"
      @mousedown.self.prevent="onBackdropMouseDown"
    />
    <div
      v-if="visible"
      ref="card"
      class="mt-tag-card"
      :style="cardStyle"
    >
      <div :style="titleStyle">
        {{ t('tagPopover.title') }}
      </div>
      <el-input
        ref="inputRef"
        v-model="draft"
        size="small"
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
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ElInput } from 'element-plus'

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

const report = (message: string): void => {
  try {
    window.electron.ipcRenderer.send('mt::tag::log', message)
  } catch {
    // Diagnostics must never break the feature.
  }
}

// Inline styles on purpose: the card must render even if the theme custom
// properties are unavailable in this window.
const cardStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${anchor.value.x}px`,
  top: `${anchor.value.y}px`,
  width: '320px',
  padding: '12px',
  boxSizing: 'border-box' as const,
  borderRadius: '8px',
  border: '2px solid #21b56f',
  background: '#ffffff',
  color: '#333333',
  boxShadow: '0 8px 28px rgba(0, 0, 0, 0.28)',
  zIndex: 2147483647
}))

const backdropStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 2147483646
}

const titleStyle = { fontSize: '13px', fontWeight: 600, marginBottom: '8px' }
const hintStyle = { marginTop: '6px', fontSize: '12px', lineHeight: 1.4, color: '#888888' }
const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }

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

// Position captured while the DOM is still live: the native menu and Muya's
// re-render can invalidate the range, in which case the range rect collapses to
// 0,0 and the card would land in the window corner.
let lastAnchor: { x: number; y: number } | null = null

const rememberAnchor = (pointerX?: number, pointerY?: number): void => {
  let rect: DOMRect | null = null
  try {
    rect = savedRange?.getBoundingClientRect() ?? null
  } catch {
    rect = null
  }
  const hasRect = !!rect && (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0)
  if (hasRect && rect) {
    lastAnchor = { x: rect.left, y: rect.bottom + 6 }
    return
  }
  if (typeof pointerX === 'number' && typeof pointerY === 'number') {
    lastAnchor = { x: pointerX, y: pointerY }
  }
}

const open = (): void => {
  try {
    captureCaret()
    openedAt = Date.now()

    const desired = lastAnchor ?? { x: 24, y: 96 }
    const width = 320
    const height = 170
    const x = Math.max(8, Math.min(desired.x, window.innerWidth - width - 8))
    const y =
      desired.y + height > window.innerHeight
        ? Math.max(8, desired.y - height - 6)
        : desired.y
    anchor.value = { x, y }
    draft.value = ''
    visible.value = true
    report('popover opened in renderer')

    nextTick(() => {
      requestAnimationFrame(() => {
        const element = card.value
        if (!element) {
          report('card element missing after nextTick')
          return
        }
        const box = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        report(
          `card rect=${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} ` +
            `viewport=${window.innerWidth}x${window.innerHeight} display=${style.display} ` +
            `visibility=${style.visibility} opacity=${style.opacity} zIndex=${style.zIndex}`
        )
        inputRef.value?.focus()
      })
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
    report(`insert ${inserted ? 'ok' : 'rejected'}: ${payload}`)
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

const onDocumentContextMenu = (event: MouseEvent): void => {
  captureCaret()
  rememberAnchor(event.clientX, event.clientY)
}

const onDocumentKeyDown = (event: KeyboardEvent): void => {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 't') {
    event.preventDefault()
    if (visible.value) {
      close()
    } else {
      captureCaret()
      rememberAnchor()
      open()
    }
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
