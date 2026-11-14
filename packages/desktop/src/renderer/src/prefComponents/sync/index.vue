<template>
  <div class="pref-sync">
    <h4>{{ t('preferences.sync.title') }}</h4>
    <p class="notes">
      {{ t('preferences.sync.description') }}
    </p>

    <compound>
      <template #head>
        <h6 class="title">
          {{ t('preferences.sync.basic.title') }}
        </h6>
      </template>
      <template #children>
        <div class="row">
          <el-switch v-model="form.enabled" />
          <span class="row-label">{{ t('preferences.sync.basic.enabled') }}</span>
        </div>

        <div class="row">
          <span class="row-label">{{ t('preferences.sync.basic.provider') }}</span>
          <el-select
            v-model="form.provider"
            class="row-select"
          >
            <el-option
              label="WebDAV"
              value="webdav"
            />
            <el-option
              :label="t('preferences.sync.basic.providerGit')"
              value="git"
            />
          </el-select>
        </div>

        <div class="row">
          <span class="row-label">{{ t('preferences.sync.basic.workspace') }}</span>
          <el-input
            :model-value="form.workspaceDir"
            readonly
            class="row-input"
            :placeholder="t('preferences.sync.basic.workspacePlaceholder')"
          />
          <el-button
            size="small"
            @click="chooseWorkspace"
          >
            {{ t('preferences.sync.basic.choose') }}
          </el-button>
        </div>

        <div class="row">
          <span class="row-label">{{ t('preferences.sync.basic.interval') }}</span>
          <el-input-number
            v-model="form.intervalMinutes"
            :min="0"
            :max="1440"
            :step="5"
            controls-position="right"
          />
          <span class="row-hint">{{ t('preferences.sync.basic.intervalHint') }}</span>
        </div>

        <div class="row">
          <span class="row-label">{{ t('preferences.sync.basic.conflictPolicy') }}</span>
          <el-select
            v-model="form.conflictPolicy"
            class="row-select"
          >
            <el-option
              :label="t('preferences.sync.basic.conflictKeepBoth')"
              value="keep-both"
            />
            <el-option
              :label="t('preferences.sync.basic.conflictLocal')"
              value="local-wins"
            />
            <el-option
              :label="t('preferences.sync.basic.conflictRemote')"
              value="remote-wins"
            />
          </el-select>
        </div>
        <p class="notes">
          {{ t('preferences.sync.basic.conflictHint') }}
        </p>
      </template>
    </compound>

    <compound v-if="form.provider === 'webdav'">
      <template #head>
        <h6 class="title">
          {{ t('preferences.sync.webdav.title') }}
        </h6>
      </template>
      <template #children>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.webdav.url') }}</span>
          <el-input
            v-model="form.webdav.url"
            class="row-input"
            placeholder="https://dav.jianguoyun.com/dav/"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.webdav.remoteDir') }}</span>
          <el-input
            v-model="form.webdav.remoteDir"
            class="row-input"
            placeholder="marktext"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.webdav.username') }}</span>
          <el-input
            v-model="form.webdav.username"
            class="row-input"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.webdav.password') }}</span>
          <el-input
            v-model="form.webdav.password"
            type="password"
            show-password
            class="row-input"
          />
        </div>
        <div class="row">
          <el-checkbox v-model="form.webdav.allowInsecure">
            {{ t('preferences.sync.webdav.allowInsecure') }}
          </el-checkbox>
        </div>
        <p class="notes">
          {{ t('preferences.sync.webdav.hint') }}
        </p>
      </template>
    </compound>

    <compound v-else>
      <template #head>
        <h6 class="title">
          {{ t('preferences.sync.git.title') }}
        </h6>
      </template>
      <template #children>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.git.remoteUrl') }}</span>
          <el-input
            v-model="form.git.remoteUrl"
            class="row-input"
            placeholder="http://gitlab.local/team/docs.git"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.git.branch') }}</span>
          <el-input
            v-model="form.git.branch"
            class="row-input"
            placeholder="main"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.git.userName') }}</span>
          <el-input
            v-model="form.git.userName"
            class="row-input"
          />
        </div>
        <div class="row">
          <span class="row-label">{{ t('preferences.sync.git.userEmail') }}</span>
          <el-input
            v-model="form.git.userEmail"
            class="row-input"
          />
        </div>
        <p class="notes">
          {{ t('preferences.sync.git.hint') }}
        </p>
      </template>
    </compound>

    <div class="actions">
      <el-button
        type="primary"
        :loading="saving"
        @click="save"
      >
        {{ t('preferences.sync.actions.save') }}
      </el-button>
      <el-button
        :loading="testing"
        @click="testConnection"
      >
        {{ t('preferences.sync.actions.test') }}
      </el-button>
      <el-button
        :loading="status.running"
        @click="syncNow"
      >
        {{ t('preferences.sync.actions.syncNow') }}
      </el-button>
    </div>

    <el-alert
      v-if="feedback"
      class="feedback"
      :title="feedback.text"
      :type="feedback.type"
      :closable="false"
      show-icon
    />
    <p class="notes status-line">
      {{ statusText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Compound from '../common/compound/index.vue'
import type { SyncConfig, SyncStatus } from '@shared/types/sync'

const { t } = useI18n()

const emptyConfig = (): SyncConfig => ({
  enabled: false,
  provider: 'webdav',
  workspaceDir: '',
  intervalMinutes: 10,
  conflictPolicy: 'keep-both',
  debounceMs: 3000,
  webdav: { url: '', username: '', password: '', remoteDir: 'marktext', allowInsecure: false },
  git: { remoteUrl: '', branch: 'main', userName: '', userEmail: '' }
})

const form = reactive<SyncConfig>(emptyConfig())
const status = reactive<SyncStatus>({
  phase: 'idle',
  message: '',
  lastSyncAt: null,
  lastResult: null,
  running: false
})
const saving = ref(false)
const testing = ref(false)
const feedback = ref<{ text: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null)

let unsubscribe: (() => void) | null = null

const applyConfig = (config: SyncConfig): void => {
  Object.assign(form, config)
  form.webdav = { ...form.webdav, ...config.webdav }
  form.git = { ...form.git, ...config.git }
}

const applyStatus = (next: SyncStatus): void => {
  Object.assign(status, next)
}

const statusText = computed<string>(() => {
  if (status.phase === 'disabled') return t('preferences.sync.status.disabled')
  if (status.phase === 'error') return t('preferences.sync.status.error', { message: status.message })
  if (status.running) return t('preferences.sync.status.running')
  if (!status.lastSyncAt) return t('preferences.sync.status.never')
  const counts = status.lastResult
  const time = new Date(status.lastSyncAt).toLocaleTimeString()
  if (!counts) return t('preferences.sync.status.lastRun', { time })
  return t('preferences.sync.status.summary', {
    time,
    uploaded: counts.uploaded,
    downloaded: counts.downloaded,
    conflicts: counts.conflicts.length
  })
})

const chooseWorkspace = async (): Promise<void> => {
  const selected = await window.cloudSync.chooseWorkspace()
  if (selected) form.workspaceDir = selected
}

const save = async (): Promise<void> => {
  saving.value = true
  try {
    const saved = await window.cloudSync.setConfig(JSON.parse(JSON.stringify(form)))
    applyConfig(saved)
    feedback.value = { text: t('preferences.sync.feedback.saved'), type: 'success' }
  } catch (error) {
    feedback.value = {
      text: error instanceof Error ? error.message : String(error),
      type: 'error'
    }
  } finally {
    saving.value = false
  }
}

const testConnection = async (): Promise<void> => {
  testing.value = true
  try {
    const result = await window.cloudSync.test(JSON.parse(JSON.stringify(form)))
    feedback.value = {
      text: result.message,
      type: result.ok ? 'success' : 'error'
    }
  } catch (error) {
    feedback.value = { text: error instanceof Error ? error.message : String(error), type: 'error' }
  } finally {
    testing.value = false
  }
}

const syncNow = async (): Promise<void> => {
  await save()
  const next = await window.cloudSync.run()
  applyStatus(next)
}

onMounted(async () => {
  applyConfig(await window.cloudSync.getConfig())
  applyStatus(await window.cloudSync.status())
  unsubscribe = window.cloudSync.onStatus(applyStatus)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.pref-sync .row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 14px;
  color: var(--editorColor);
}

.pref-sync .row-label {
  min-width: 170px;
  user-select: none;
}

.pref-sync .row-select {
  width: 220px;
}

.pref-sync .row-input {
  flex: 1;
  max-width: 520px;
}

.pref-sync .row-hint {
  font-size: 12px;
  color: var(--editorColor50);
}

.pref-sync .actions {
  display: flex;
  gap: 10px;
  margin: 20px 0 10px;
}

.pref-sync .feedback {
  max-width: 720px;
  margin-bottom: 8px;
}

.pref-sync .status-line {
  font-style: normal;
}
</style>
